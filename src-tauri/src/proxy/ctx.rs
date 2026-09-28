use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use rama::http::header;
use rama::http::request::Parts;
use rama::http::{HeaderMap, HeaderName, Method};
use rama::net::address::HostWithOptPort;
use rama::net::uri::Uri;
use rama::net::{AuthorityInputExt, ProtocolInputExt};
use tauri::ipc::Channel;

use crate::config::Settings;
use crate::config::db::Db;
use crate::proxy::ai::session::{SessionStore, TimelineEntry};
use crate::proxy::events::ProxyEvent;
use crate::storage::id;

/// Shared context for a single proxy request.
pub(crate) struct ProxyCtx {
    request_id: u64,
    /// 请求行/头部定稿（脚本执行后）；extensions 已清空，仅保留 method/uri/version/headers。
    parts: Parts,
    /// 惰性解析缓存：解码后的查询参数（首次访问时解析一次）。
    query_params: OnceLock<HashMap<String, String>>,
    /// 惰性解析缓存：请求头 KV（重复 header 已合并；首次访问时收集一次）。
    header_map: OnceLock<HashMap<String, String>>,
    start_ms: i64,
    sender: Option<Channel<ProxyEvent>>,
    /// 本请求的 Settings 快照（构造时克隆，请求期间稳定不变）。
    settings: Settings,
    /// AI 会话表（proxy 流量有；resend 等场景为 None）。
    sessions: Option<Arc<Mutex<SessionStore>>>,
    /// 请求侧归一化判定出的 (provider, session_id)，供响应侧消费。
    /// 每请求最多写一次（请求侧），之后只读（响应侧），故用 OnceLock 而非 Mutex。
    ai_req: OnceLock<(crate::proxy::ai::Provider, String)>,
    /// 请求侧归一化：本次请求的增量 user turns（含 fingerprint）存入 ctx，
    /// 供响应侧构造时间线增量（AiTimeline delta）。
    request_delta: OnceLock<Vec<TimelineEntry>>,
    /// DB 连接（proxy 解密流量有；resend 等场景为 None）。
    db: Option<Arc<Db>>,
    /// 当前请求在 traffic_logs 表中的行 id（插入后由 DB 分配；写一次后只读）。
    db_id: OnceLock<i64>,
}

impl ProxyCtx {
    pub(crate) fn new(
        mut parts: Parts,
        sender: Option<Channel<ProxyEvent>>,
        settings: Settings,
        start_ms: Option<i64>,
    ) -> Self {
        // MITM 解密后的 HTTP/1.1 请求行是 origin-form（仅 /path?query）：用 rama 请求上下文
        // API 补全为绝对地址，事件/DB/AI 检测统一拿到完整 URL。
        // - scheme：ProtocolInputExt::protocol()（TLS 终结连接带 SecureTransport 标记 → https）
        // - authority：AuthorityInputExt::authority()（uri host → TLS SNI → Forwarded → Host 头）
        // 须在清空 extensions 之前执行；仅影响 ctx 这份记录用的克隆，不改真实转发的请求。
        if !parts.uri.is_absolute()
            && let Some(protocol) = parts.protocol()
            && let Some(authority) = parts.authority()
        {
            let HostWithOptPort { host, port } = authority;
            // 协议默认端口（443/80）不写入 URL，与浏览器地址栏一致
            let authority = match port.as_u16() {
                Some(p) if protocol.default_port() != Some(p) => format!("{host}:{p}"),
                _ => host.to_string(),
            };
            if let Ok(uri) =
                format!("{protocol}://{authority}{}", parts.uri.request_target()).parse()
            {
                parts.uri = uri;
            }
        }
        // extensions 携带 State 等运行时引用，ctx 只需要 method/uri/headers，清空避免多余持有。
        parts.extensions = Default::default();
        let start_ms = start_ms.unwrap_or_else(crate::utils::date::now_ms);
        Self {
            request_id: id::next_request_id(),
            parts,
            query_params: OnceLock::new(),
            header_map: OnceLock::new(),
            start_ms,
            sender,
            settings,
            sessions: None,
            ai_req: OnceLock::new(),
            request_delta: OnceLock::new(),
            db: None,
            db_id: OnceLock::new(),
        }
    }

    /// 附加 AI 会话表（proxy 转发路径调用）。
    pub(crate) fn with_sessions(mut self, sessions: Arc<Mutex<SessionStore>>) -> Self {
        self.sessions = Some(sessions);
        self
    }

    /// 附加 DB 连接（proxy 解密流量路径调用）。
    pub(crate) fn with_db(mut self, db: Arc<Db>) -> Self {
        self.db = Some(db);
        self
    }

    pub(crate) fn sessions(&self) -> Option<&Arc<Mutex<SessionStore>>> {
        self.sessions.as_ref()
    }

    /// DB 行 ID：响应侧/错误侧写入时复用。仅首次写入生效。
    pub(crate) fn set_db_id(&self, id: i64) {
        self.db_id.set(id).ok();
    }

    pub(crate) fn db_id(&self) -> Option<i64> {
        self.db_id.get().copied()
    }

    pub(crate) fn db_ref(&self) -> Option<&Arc<Db>> {
        self.db.as_ref()
    }

    /// 请求侧登记归一化判定结果。仅首次写入生效。
    pub(crate) fn set_ai_req(&self, provider: crate::proxy::ai::Provider, session_id: String) {
        self.ai_req.set((provider, session_id)).ok();
    }

    /// 响应侧读取请求侧判定结果（浅克隆）。
    pub(crate) fn ai_req(&self) -> Option<(crate::proxy::ai::Provider, String)> {
        self.ai_req.get().cloned()
    }

    pub(crate) fn request_id(&self) -> u64 {
        self.request_id
    }

    pub(crate) fn method(&self) -> &Method {
        &self.parts.method
    }

    pub(crate) fn uri(&self) -> &Uri {
        &self.parts.uri
    }

    #[allow(dead_code)]
    pub(crate) fn headers(&self) -> &HeaderMap {
        &self.parts.headers
    }

    /// 读取指定请求头的字符串值（按 HeaderName 常量查，避免字符串字面量）。
    pub(crate) fn header(&self, name: &HeaderName) -> Option<&str> {
        self.parts.headers.get(name).and_then(|v| v.to_str().ok())
    }

    /// 从 URI 取 host；若 URI 为 origin-form（MITM 解密后），回退到 Host 请求头。
    /// 两者都不可用时返回 ""。
    pub(crate) fn host_str(&self) -> String {
        self.parts
            .uri
            .host_str()
            .as_deref()
            .or_else(|| self.header(&header::HOST))
            .unwrap_or("")
            .to_string()
    }

    /// 解码后的查询参数（惰性解析，多次调用只解析一次）。
    pub(crate) fn query_params(&self) -> &HashMap<String, String> {
        self.query_params
            .get_or_init(|| parse_query_params(&self.parts.uri))
    }

    /// 请求头 KV Map（重复 header 已合并；惰性收集，多次调用只收集一次）。
    pub(crate) fn header_map(&self) -> &HashMap<String, String> {
        self.header_map
            .get_or_init(|| collect_headers(&self.parts.headers))
    }

    /// 请求头 KV 数组 JSON（入库格式；基于缓存的 header_map 序列化）。
    pub(crate) fn headers_json(&self) -> String {
        map_to_kv_json(self.header_map())
    }

    /// 查询参数 KV 数组 JSON（入库格式；基于缓存的 query_params 序列化）。
    pub(crate) fn query_json(&self) -> String {
        map_to_kv_json(self.query_params())
    }

    pub(crate) fn sender(&self) -> &Option<Channel<ProxyEvent>> {
        &self.sender
    }

    pub(crate) fn settings(&self) -> &Settings {
        &self.settings
    }

    /// 请求侧登记本次请求的增量 turns（已含 fingerprint）。仅首次写入生效。
    pub(crate) fn set_ai_request_delta(&self, delta: Vec<TimelineEntry>) {
        self.request_delta.set(delta).ok();
    }

    /// 响应侧读取请求侧增量 turns（浅克隆）。
    pub(crate) fn request_delta(&self) -> Vec<TimelineEntry> {
        self.request_delta.get().cloned().unwrap_or_default()
    }

    pub(crate) fn start_ms(&self) -> i64 {
        self.start_ms
    }

    #[allow(dead_code)]
    pub(crate) fn duration_ms(&self) -> u64 {
        // max(0)：时钟回拨时避免负数被 as u64 变成天文数字
        (crate::utils::date::now_ms() - self.start_ms).max(0) as u64
    }

    pub(crate) fn send(&self, event: ProxyEvent) {
        if let Some(ref ch) = self.sender {
            ch.send(event).ok();
        }
    }
}

// ── 解析辅助（供上面的惰性缓存初始化调用）──

/// 将 KV Map 转为纯 JSON 对象（入库格式）。
pub(crate) fn map_to_kv_json(map: &HashMap<String, String>) -> String {
    serde_json::to_string(map).unwrap_or_else(|_| "{}".to_string())
}

/// 简易 URL 百分号解码。
/// 先按字节收集再统一 UTF-8 解码，保证多字节字符（如中文 `%E4%BD%A0`）正确还原。
fn url_decode(input: &str) -> String {
    let mut bytes = Vec::with_capacity(input.len());
    let mut chars = input.chars();
    while let Some(ch) = chars.next() {
        if ch == '%' {
            let hex: String = chars.by_ref().take(2).collect();
            if hex.len() == 2
                && let Ok(byte) = u8::from_str_radix(&hex, 16)
            {
                bytes.push(byte);
                continue;
            }
            // 无效的百分号编码，保留原样
            bytes.push(b'%');
            bytes.extend_from_slice(hex.as_bytes());
        } else if ch == '+' {
            bytes.push(b' ');
        } else {
            let mut buf = [0u8; 4];
            bytes.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// 解析 URI 查询参数为解码后的 Map。
pub(crate) fn parse_query_params(uri: &Uri) -> HashMap<String, String> {
    uri.query()
        .map(|q| {
            q.as_encoded_str()
                .split('&')
                .filter_map(|pair| {
                    let mut parts = pair.splitn(2, '=');
                    let key = parts.next()?;
                    let value = parts.next().unwrap_or("");
                    Some((url_decode(key), url_decode(value)))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// 收集 HeaderMap 为 KV Map，重复头按规则合并：
/// - `Set-Cookie`（响应头，协议允许多头）用 `\n` 分隔，保留每条 cookie 的完整属性；
/// - 其余同名头用 `", "` 合并（符合 RFC 7230）。
///
/// 请求/响应通用：调用方传请求头或响应头皆可。
pub(crate) fn collect_headers(headers: &HeaderMap) -> HashMap<String, String> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            let key = name.as_str().to_ascii_lowercase();
            let val = value.to_str().ok()?.to_string();
            Some((key, val))
        })
        .fold(HashMap::new(), |mut acc, (key, val)| {
            if let Some(existing) = acc.get_mut(&key) {
                if key.eq_ignore_ascii_case("set-cookie") {
                    existing.push('\n');
                } else {
                    existing.push_str(", ");
                }
                existing.push_str(&val);
            } else {
                acc.insert(key, val);
            }
            acc
        })
}
