use std::convert::Infallible;

use bytes::Bytes;
use rama::extensions::ExtensionsRef;
use rama::http::header;
use rama::http::{Body, Request, Response, StatusCode};
use rama::layer::Layer;
use rama::service::Service;

use crate::proxy::error_response;
use crate::proxy::events::ProxyEvent;
use crate::proxy::ext::CachedRequestBody;
use crate::proxy::ext::RequestExt;
use crate::proxy::state::State;
use crate::script;

/// Script layer that applies both request and response hooks.
///
/// Wraps the `http_mitm_proxy` handler: on the request side, collects the body,
/// runs `onRequest` hooks, and either blocks (returning 403) or passes the
/// modified request through; on the response side, collects the response body,
/// runs `onResponse` hooks, and returns the modified response.
///
/// When no scripts match the request (host + method), the layer is a transparent
/// pass-through — body collection is skipped entirely.
#[derive(Clone, Default)]
pub(crate) struct ScriptLayer;

impl<S> Layer<S> for ScriptLayer {
    type Service = ScriptService<S>;

    fn layer(&self, inner: S) -> Self::Service {
        ScriptService { inner }
    }
}

pub(crate) struct ScriptService<S> {
    inner: S,
}

// Clone is required by new_http_mitm_proxy → Arc::new(…).
impl<S: Clone> Clone for ScriptService<S> {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
        }
    }
}

impl<S> Service<Request> for ScriptService<S>
where
    S: Service<Request, Output = Response, Error = Infallible> + Clone + Send + 'static,
{
    type Output = Response;
    type Error = Infallible;

    async fn serve(&self, req: Request) -> Result<Response, Infallible> {
        let state: State = req.ext();

        // ── fast path: 开关关闭 / 无脚本 → 直接透传（read guard 随表达式结束 drop）──
        if !state.settings().script.enabled || state.settings().script.scripts.is_empty() {
            return self.inner.serve(req).await;
        }

        // ── 有脚本: 锁一次 → 匹配 → 释放 ──
        let scripts = {
            let settings = state.settings();
            let method = req.method().as_str();
            let host: std::borrow::Cow<'_, str> = match req.uri().host_str() {
                Some(h) => h,
                None => req
                    .headers()
                    .get(header::HOST)
                    .and_then(|v| v.to_str().ok())
                    .map(std::borrow::Cow::Borrowed)
                    .unwrap_or(std::borrow::Cow::Borrowed("")),
            };
            state.get_scripts_with(&settings, &host, method)
        };
        // RwLockReadGuard 已在块结束时 drop，后续 await 无 Send 问题

        if scripts.is_empty() {
            return self.inner.serve(req).await;
        }

        let (parts, body) = req.into_parts();

        // ── request hooks ──
        let modified_req = match apply_request_scripts(&state, &scripts, parts, body).await {
            Ok(req) => req,
            Err(blocked_response) => return Ok(*blocked_response),
        };

        // ── forward to inner handler ──
        let resp = self.inner.serve(modified_req).await?;

        // ── response hooks ──
        Ok(apply_response_scripts(&scripts, resp).await)
    }
}

// ── Request-side helper (extracted from http_mitm_proxy) ──

/// Collect the request body, run all matching onRequest hooks in sequence,
/// and rebuild the request from the (possibly modified) data.
///
/// Returns `Err(403_response)` when a script explicitly blocks the request.
async fn apply_request_scripts(
    state: &State,
    scripts: &[String],
    parts: rama::http::request::Parts,
    body: Body,
) -> Result<Request, Box<Response>> {
    let body_str = match script::collect_body_str(body).await {
        Ok(s) => s,
        // Body exceeds capture limit → skip scripts, forward as-is.
        Err(body) => {
            log::warn!("[script] request body exceeds capture limit, skipping request hooks");
            return Ok(Request::from_parts(parts, body));
        }
    };

    let req_data = script::RequestData::from_rama_parts(&parts, body_str);

    match script::run_request_hooks(scripts, req_data) {
        Some(modified) => {
            // 缓存改写后的 body，下游（TrafficRecorderLayer / AiPipeline）
            // 通过 extensions 读取，避免重复收集 body 流。
            let body_bytes = Bytes::from(modified.body.clone());
            let req = modified.apply(parts);
            req.extensions().insert(CachedRequestBody(body_bytes));
            Ok(req)
        }
        None => {
            log::info!("[script] request blocked");
            if let Some(ref ch) = state.event_channel() {
                ch.send(ProxyEvent::Error {
                    id: 0,
                    error: "Request blocked by script".into(),
                })
                .ok();
            }
            Err(Box::new(error_response(
                StatusCode::FORBIDDEN,
                "Blocked by script",
            )))
        }
    }
}

// ── Response-side helper ──

/// Collect the response body, run all onResponse hooks in sequence, and rebuild.
async fn apply_response_scripts(scripts: &[String], resp: Response) -> Response {
    let (parts, body) = resp.into_parts();

    let body_str = match script::collect_body_str(body).await {
        Ok(s) => s,
        Err(body) => {
            log::warn!("[script] response body exceeds capture limit, skipping response hooks");
            return Response::from_parts(parts, body);
        }
    };

    let resp_data = script::ResponseData::from_rama_parts(&parts, body_str);
    script::run_response_hooks(scripts, resp_data).apply(parts)
}
