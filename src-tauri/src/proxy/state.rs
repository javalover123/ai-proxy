use crate::proxy::ai::session::SessionStore;
use crate::proxy::events::ProxyEvent;
use rama::error::BoxError;
use rama::extensions::Extension;
use rama::http::{Request, Response};
use rama::service::BoxService;
use rama::tls::server::TlsServerConfig;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use tauri::ipc::Channel;
use tokio::sync::oneshot;

use crate::config::db::Db;
use crate::config::{Settings, Store};

#[derive(Clone, Extension)]
pub(crate) struct State {
    mitm_tls_service_data: TlsServerConfig,
    read_settings: Arc<RwLock<Settings>>,
    /// 脚本文件目录。运行时从 Store 派生，不属于序列化配置，故独立于 Settings 持有。
    scripts_dir: PathBuf,
    event_channel: Arc<RwLock<Option<Channel<ProxyEvent>>>>,
    /// 跨请求 AI 会话表（内存，不持久化）。
    sessions: Arc<Mutex<SessionStore>>,
    /// DB 连接（解密流量的 traffic_log 持久化）。
    db: Arc<Db>,
}

impl std::fmt::Debug for State {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("State")
            .field("mitm_tls_service_data", &self.mitm_tls_service_data)
            .field("settings", &self.read_settings)
            .field("db", &"<Db>")
            .finish()
    }
}

#[derive(Debug, Clone, Copy, Extension)]
pub(crate) struct ViaConnectTunnel;

/// 请求入口时间戳（毫秒），由 `http_connect_proxy` 注入，MITM 路径消费。
#[derive(Debug, Clone, Copy, Extension)]
pub(crate) struct StartTime(pub i64);

impl State {
    pub(crate) fn with_sessions(
        mitm_tls_service_data: TlsServerConfig,
        read_settings: Arc<RwLock<Settings>>,
        scripts_dir: PathBuf,
        event_channel: Arc<RwLock<Option<Channel<ProxyEvent>>>>,
        db: Arc<Db>,
        sessions: Arc<Mutex<SessionStore>>,
    ) -> Self {
        Self {
            mitm_tls_service_data,
            read_settings,
            scripts_dir,
            event_channel,
            sessions,
            db,
        }
    }

    /// 访问共享的 AI 会话表。
    pub(crate) fn sessions(&self) -> Arc<Mutex<SessionStore>> {
        self.sessions.clone()
    }

    /// 访问 DB 连接（用于解密流量持久化）。
    pub(crate) fn db(&self) -> Arc<Db> {
        self.db.clone()
    }

    /// 上游 HTTP 客户端（含超时/解压/流标准化；OnceLock 缓存，首次调用时构建）。
    pub(crate) fn upstream_client(&self) -> BoxService<Request, Response, BoxError> {
        let upstream_proxy = self.settings().proxy.upstream_proxy_address();
        crate::proxy::client::build_upstream_service(upstream_proxy, true)
    }

    pub(crate) fn mitm_tls_service_data(&self) -> &TlsServerConfig {
        &self.mitm_tls_service_data
    }

    /// 同 [`get_scripts`]，但从已有的 `&Settings` 读取，避免重复加锁。
    /// 调用方负责持有 settings 读锁。
    pub(crate) fn get_scripts_with(
        &self,
        settings: &crate::config::Settings,
        host: &str,
        method: &str,
    ) -> Vec<String> {
        let config = &settings.script;
        config
            .scripts
            .iter()
            .filter(|item| item.matches(host, method))
            .filter_map(|item| {
                let path = self.scripts_dir.join(&item.file_name);
                match std::fs::read_to_string(&path) {
                    Ok(content) if !content.trim().is_empty() => Some(content),
                    Ok(_) => {
                        log::warn!("[script] Skipped empty script {}", path.display());
                        None
                    }
                    Err(e) => {
                        log::error!("[script] Failed to read {}: {e}", path.display());
                        None
                    }
                }
            })
            .collect()
    }

    pub(crate) fn settings(&self) -> std::sync::RwLockReadGuard<'_, Settings> {
        self.read_settings.read().expect("settings lock")
    }

    pub(crate) fn event_channel(&self) -> Option<Channel<ProxyEvent>> {
        self.event_channel
            .read()
            .expect("event_channel lock")
            .clone()
    }
}

pub(crate) struct AppState {
    settings: Arc<RwLock<Settings>>,
    running: Arc<AtomicBool>,
    store: Store,
    shutdown_signal: Arc<Mutex<Option<oneshot::Sender<()>>>>,
    proxy_event_channel: Arc<RwLock<Option<Channel<ProxyEvent>>>>,
    pending_open_settings: Arc<AtomicBool>,
}

impl AppState {
    pub(crate) fn new(store: Store, settings: Settings) -> Self {
        Self {
            settings: Arc::new(RwLock::new(settings)),
            running: Arc::new(AtomicBool::new(false)),
            store,
            shutdown_signal: Arc::new(Mutex::new(None)),
            proxy_event_channel: Arc::new(RwLock::new(None)),
            pending_open_settings: Arc::new(AtomicBool::new(false)),
        }
    }

    pub(crate) fn event_channel(&self) -> Option<Channel<ProxyEvent>> {
        self.proxy_event_channel.read().expect("lock").clone()
    }

    pub(crate) fn event_channel_arc(&self) -> Arc<RwLock<Option<Channel<ProxyEvent>>>> {
        self.proxy_event_channel.clone()
    }

    pub(crate) fn settings_arc(&self) -> Arc<RwLock<Settings>> {
        self.settings.clone()
    }

    pub(crate) fn set_event_channel(&self, channel: Channel<ProxyEvent>) {
        *self.proxy_event_channel.write().expect("lock") = Some(channel);
    }

    pub(crate) fn store(&self) -> &Store {
        &self.store
    }

    pub(crate) fn running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }
    pub(crate) fn set_running(&self, v: bool) {
        self.running.store(v, Ordering::SeqCst);
    }

    pub(crate) fn set_shutdown_signal(&self, tx: oneshot::Sender<()>) {
        *self.shutdown_signal.lock().expect("lock") = Some(tx);
    }

    pub(crate) fn take_shutdown_signal(&self) -> Option<oneshot::Sender<()>> {
        self.shutdown_signal.lock().expect("lock").take()
    }

    pub(crate) fn set_pending_open_settings(&self, v: bool) {
        self.pending_open_settings.store(v, Ordering::SeqCst);
    }

    pub(crate) fn take_pending_open_settings(&self) -> bool {
        self.pending_open_settings.swap(false, Ordering::SeqCst)
    }

    pub(crate) fn set_settings(&self, settings: Settings) {
        *self.settings.write().expect("lock") = settings;
    }

    pub(crate) fn db(&self) -> Arc<Db> {
        self.store().db()
    }

    pub(crate) fn settings(&self) -> Settings {
        self.settings.read().expect("lock").clone()
    }
}
