use std::collections::HashMap;
use std::convert::Infallible;
use std::time::Duration;

use rama::http::{Body, Method, Request, Response, StatusCode, header};
use rama::layer::Layer;
use rama::net::address::HostWithOptPort;
use rama::net::{AuthorityInputExt, ProtocolInputExt};
use rama::service::Service;
use serde::Deserialize;
use serde::Serialize;

use crate::config::{AuthzOnError, AuthzRule};
use crate::proxy::client;
use crate::proxy::ctx::{collect_headers, parse_query_params};
use crate::proxy::error_response;
use crate::proxy::events::ProxyEvent;
use crate::proxy::ext::RequestExt;
use crate::proxy::state::{StartTime, State};
use crate::script::collect_body_str;
use crate::storage::id;

/// extAuthz 授权层：把匹配到的请求的元数据（method / 绝对 URI / headers）POST 给外部
/// 授权服务，据其响应放行或拒绝。
///
/// - 放行（2xx）：可选解析 body 中的 `{"headers": {...}}` 注入到上游请求（覆盖同名头）。
/// - 拒绝（非 2xx）：透传授权服务的响应（status + headers + body）给客户端，不落库、不转发。
/// - 服务不可用（超时 / 连接失败）：按规则 `on_error`（closed 拒绝 / open 放行）。
///
/// 位于 ScriptLayer 之前：授权先于脚本改写与流量录制/转发。无匹配规则时透明透传。
#[derive(Clone, Default)]
pub(crate) struct ExtAuthzLayer;

impl<S> Layer<S> for ExtAuthzLayer {
    type Service = ExtAuthzService<S>;

    fn layer(&self, inner: S) -> Self::Service {
        ExtAuthzService { inner }
    }
}

pub(crate) struct ExtAuthzService<S> {
    inner: S,
}

impl<S: Clone> Clone for ExtAuthzService<S> {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
        }
    }
}

/// 授权检查请求体（HTTP/JSON 契约，仅元数据，不收 body）。
#[derive(Serialize)]
struct AuthzCheckRequest {
    method: String,
    uri: String,
    headers: HashMap<String, String>,
}

/// 授权检查响应（放行时可选解析；拒绝时直接透传，无需解析）。
#[derive(Deserialize)]
struct AuthzAllowResponse {
    #[serde(default)]
    headers: HashMap<String, String>,
}

/// 一次授权检查的结果。
enum AuthzDecision {
    /// 放行，携带要注入上游请求的头（覆盖同名）。
    Allow(HashMap<String, String>),
    /// 拒绝，透传授权服务的响应。
    Deny(Response),
    /// 授权服务不可用，走规则 `on_error`。
    Unavailable,
}

impl<S> Service<Request> for ExtAuthzService<S>
where
    S: Service<Request, Output = Response, Error = Infallible> + Clone + Send + 'static,
{
    type Output = Response;
    type Error = Infallible;

    async fn serve(&self, mut req: Request) -> Result<Response, Infallible> {
        let state: State = req.ext();

        // ── fast path：开关关闭 / 无规则 → 直接透传 ──
        if !state.settings().authz.enabled || state.settings().authz.rules.is_empty() {
            return self.inner.serve(req).await;
        }

        let method = req.method().as_str();
        let host = req
            .uri()
            .host_str()
            .map(|h| h.into_owned())
            .or_else(|| {
                req.headers()
                    .get(header::HOST)
                    .and_then(|v| v.to_str().ok())
                    .map(str::to_owned)
            })
            .unwrap_or_default();

        // 取首条命中规则（配置顺序即优先级），无命中则透传。
        let rule = {
            let settings = state.settings();
            state
                .get_authz_rules_with(&settings, &host, method)
                .into_iter()
                .next()
        };
        let Some(rule) = rule else {
            return self.inner.serve(req).await;
        };

        // ── 组装授权检查请求 ──
        let uri = absolute_uri(&req).unwrap_or_else(|| req.uri().to_string());
        let payload = AuthzCheckRequest {
            method: method.to_owned(),
            uri,
            headers: collect_headers(req.headers()),
        };
        let body = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".to_string());

        let authz_req = match Request::builder()
            .method(Method::POST)
            .uri(rule.url.as_str())
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body))
        {
            Ok(r) => r,
            Err(_) => {
                // URL 非法视为不可用，走 on_error。
                log::warn!("[authz] invalid rule url for rule {:?}", rule.name);
                return self.forward_or_deny(&state, req, &rule).await;
            }
        };

        match run_check(&rule, authz_req).await {
            AuthzDecision::Allow(injected) => {
                for (name, value) in injected {
                    if let (Ok(name), Ok(value)) = (
                        header::HeaderName::from_bytes(name.as_bytes()),
                        header::HeaderValue::from_str(&value),
                    ) {
                        // 覆盖同名头（Q14 决策）；content-length 由下游 ScriptLayer /
                        // TrafficRecorderLayer 重建请求时按实际长度重算。
                        req.headers_mut().insert(name, value);
                    }
                }
                self.inner.serve(req).await
            }
            AuthzDecision::Deny(resp) => {
                let status = resp.status().as_u16();
                let reason = format!("ext_authz denied by \"{}\"", rule.name);
                emit_denied(&state, &req, reason, status);
                Ok(resp)
            }
            AuthzDecision::Unavailable => self.forward_or_deny(&state, req, &rule).await,
        }
    }
}

impl<S> ExtAuthzService<S>
where
    S: Service<Request, Output = Response, Error = Infallible> + Clone + Send + 'static,
{
    /// 授权服务不可用：按 `on_error` 放行（继续转发）或拒绝（403 + Denied 事件）。
    async fn forward_or_deny(
        &self,
        state: &State,
        req: Request,
        rule: &AuthzRule,
    ) -> Result<Response, Infallible> {
        if rule.on_error == AuthzOnError::Open {
            log::warn!(
                "[authz] service unavailable for rule {:?}, fail-open",
                rule.name
            );
            return self.inner.serve(req).await;
        }
        let status = StatusCode::FORBIDDEN.as_u16();
        let reason = format!("ext_authz service unavailable (rule: \"{}\")", rule.name);
        emit_denied(state, &req, reason, status);
        Ok(error_response(
            StatusCode::FORBIDDEN,
            "Blocked by ext_authz (service unavailable)",
        ))
    }
}

/// 发起一次授权检查，返回放行 / 拒绝 / 不可用。
async fn run_check(rule: &AuthzRule, authz_req: Request) -> AuthzDecision {
    let client = client::authz_client();
    let timeout = Duration::from_millis(rule.timeout_ms.max(1));
    match tokio::time::timeout(timeout, client.serve(authz_req)).await {
        Ok(Ok(resp)) => {
            if resp.status().is_success() {
                AuthzDecision::Allow(extract_allow_headers(resp).await)
            } else {
                AuthzDecision::Deny(resp)
            }
        }
        Ok(Err(err)) => {
            log::warn!("[authz] check failed for rule {:?}: {err}", rule.name);
            AuthzDecision::Unavailable
        }
        Err(_elapsed) => {
            log::warn!(
                "[authz] check timed out ({}ms) for rule {:?}",
                rule.timeout_ms,
                rule.name
            );
            AuthzDecision::Unavailable
        }
    }
}

/// 解析放行响应 body，提取要注入的头。body 非法 / 超限 / 非 JSON 时返回空（照常放行）。
async fn extract_allow_headers(resp: Response) -> HashMap<String, String> {
    let (_, body) = resp.into_parts();
    let body_str = match collect_body_str(body).await {
        Ok(s) => s,
        Err(_) => {
            log::warn!(
                "[authz] allow response body exceeds capture limit, ignoring injected headers"
            );
            return HashMap::new();
        }
    };
    if body_str.trim().is_empty() {
        return HashMap::new();
    }
    match serde_json::from_str::<AuthzAllowResponse>(&body_str) {
        Ok(allow) => allow.headers,
        Err(_) => {
            log::warn!("[authz] allow response body is not valid JSON, ignoring injected headers");
            HashMap::new()
        }
    }
}

/// 发 Denied 事件：被拒请求不落库，仅通过实时事件流让前端可见。
fn emit_denied(state: &State, req: &Request, reason: String, status: u16) {
    let Some(ch) = state.event_channel() else {
        return;
    };
    let timestamp = req
        .try_ext::<StartTime>()
        .map(|st| st.0)
        .unwrap_or_else(crate::utils::date::now_ms);
    ch.send(ProxyEvent::Denied {
        id: id::next_request_id(),
        method: req.method().to_string(),
        uri: absolute_uri(req).unwrap_or_else(|| req.uri().to_string()),
        timestamp,
        headers: collect_headers(req.headers()),
        query_params: parse_query_params(req.uri()),
        decrypted: true,
        status,
        reason,
    })
    .ok();
}

/// 还原请求的绝对 URI。origin-form（MITM 解密流量）时用 rama 请求上下文（协议 + 权威）
/// 补全为 `protocol://authority/path?query`；已为绝对形式（明文 HTTP 转发）则原样返回。
fn absolute_uri(req: &Request) -> Option<String> {
    if req.uri().is_absolute() {
        return Some(req.uri().to_string());
    }
    let protocol = req.protocol()?;
    let authority = req.authority()?;
    let HostWithOptPort { host, port } = authority;
    let authority = match port.as_u16() {
        Some(p) if protocol.default_port() != Some(p) => format!("{host}:{p}"),
        _ => host.to_string(),
    };
    Some(format!(
        "{protocol}://{authority}{}",
        req.uri().request_target()
    ))
}
