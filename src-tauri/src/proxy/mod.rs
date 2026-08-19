use std::sync::{Arc, Mutex};
use std::time::Duration;

use rama::Layer;
use rama::error::{BoxError, ErrorContext};
use rama::http::BodyLimitLayer;
use rama::http::layer::trace::TraceLayer;
use rama::http::layer::upgrade::{LazyHttpProxyConnectReplyService, UpgradeLayer};
use rama::http::matcher::MethodMatcher;
use rama::http::server::HttpServer;
use rama::http::{Body, Response, StatusCode};
use rama::layer::{AddInputExtensionLayer, ConsumeErrLayer};
use rama::service::service_fn;
use rama::tcp::server::TcpListener;
use rama::{graceful::Shutdown, rt::Executor};
use tauri::AppHandle;
use tauri::Manager;
use tokio::sync::oneshot;

use crate::config::ProxyConfig;
use crate::proxy::ai::session::SessionStore;
use state::{AppState, State};

use mitm::{http_connect_proxy, new_http_mitm_proxy};

pub(crate) mod ai;
pub(crate) mod cert;
pub(crate) mod client;
pub(crate) mod ctx;
pub(crate) mod events;
pub(crate) mod ext;
pub(crate) mod layer;
pub(crate) mod mitm;
pub(crate) mod record;
pub(crate) mod sse;
pub(crate) mod state;

pub struct ProxyServer {
    config: ProxyConfig,
    app_handle: AppHandle,
    shutdown_rx: oneshot::Receiver<()>,
    data_dir: std::path::PathBuf,
}

impl ProxyServer {
    pub fn new(
        config: ProxyConfig,
        app_handle: AppHandle,
        shutdown_rx: oneshot::Receiver<()>,
        data_dir: std::path::PathBuf,
    ) -> Self {
        Self {
            config,
            app_handle,
            shutdown_rx,
            data_dir,
        }
    }

    pub async fn run(self) -> Result<(), BoxError> {
        let provider =
            cert::MitmCertProvider::try_new(&self.data_dir).context("MITM cert provider")?;
        let mitm_tls_service_data = provider.into_tls_server_config();

        let listen_addr = format!("{}:{}", self.config.listen_host, self.config.listen_port);

        let app_handle = self.app_handle.clone();
        let shutdown_rx = self.shutdown_rx;

        let graceful = Shutdown::new(async move {
            shutdown_rx.await.ok();
            log::info!("Shutdown signal received");
        });

        let exec = Executor::graceful(graceful.guard());
        let tcp_service = TcpListener::build(exec.clone())
            .bind_address(&listen_addr)
            .await
            .context(format!("bind tcp proxy to {listen_addr} failed"))?;

        log::info!("MITM Proxy server listening on http://{}", listen_addr);

        let app_state = app_handle.state::<AppState>();
        let db = app_state.db();
        let settings = app_state.settings_arc();
        let event_channel = app_state.event_channel_arc();

        let max_sessions = settings
            .read()
            .map(|s| s.ai.session.max_sessions)
            .unwrap_or(500);
        let sessions: Arc<Mutex<SessionStore>> =
            Arc::new(Mutex::new(SessionStore::load(&db, max_sessions)));

        graceful.spawn_task_fn({
            move |_guard| async move {
                let state = State::with_sessions(
                    mitm_tls_service_data,
                    settings,
                    event_channel,
                    db,
                    sessions,
                );

                let http_service = HttpServer::auto(exec.clone()).service(
                    (
                        TraceLayer::new_for_http(),
                        ConsumeErrLayer::default(),
                        UpgradeLayer::new_with_services(
                            exec,
                            MethodMatcher::CONNECT,
                            LazyHttpProxyConnectReplyService::new(),
                            service_fn(http_connect_proxy),
                        ),
                    )
                        .into_layer(new_http_mitm_proxy()),
                );

                tcp_service
                    .serve(
                        (
                            AddInputExtensionLayer::new(state),
                            BodyLimitLayer::symmetric(2 * 1024 * 1024),
                        )
                            .into_layer(http_service),
                    )
                    .await;
            }
        });

        graceful
            .shutdown_with_limit(Duration::from_secs(30))
            .await
            .context("graceful shutdown")?;
        Ok(())
    }
}

pub(crate) fn error_response(status: StatusCode, body: impl Into<Body>) -> Response {
    Response::builder()
        .status(status)
        .body(body.into())
        .expect("valid status code and body for error response")
}
