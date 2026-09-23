use std::collections::HashMap;

use bytes::Bytes;
use log::info;
use rama::http::{Response, header};
use tauri::ipc::Channel;

use crate::proxy::ctx::{ProxyCtx, collect_headers, map_to_kv_json};
use crate::proxy::events::ProxyEvent;
use crate::utils::buf_pool;
use crate::utils::buf_pool::{BodyObserver, CaptureOutcome};

use super::ai::response::AiState;
use super::ai::{self};
use super::sse::{SseEvent, SseFramer};

/// Accepts body as raw bytes to avoid unnecessary UTF-8 allocation;
/// only converts lossily when emitting the RequestChunk event.
pub(crate) fn record_request(ctx: &ProxyCtx, body: &[u8]) {
    let query_params = ctx.query_params();
    let req_headers = ctx.header_map();

    let req_content_type = ctx.header(&header::CONTENT_TYPE).map(str::to_owned);

    ctx.send(ProxyEvent::Request {
        id: ctx.request_id(),
        method: ctx.method().to_string(),
        uri: ctx.uri().to_string(),
        timestamp: ctx.start_ms(),
        headers: req_headers.clone(),
        query_params: query_params.clone(),
        decrypted: true,
        content_type: req_content_type,
    });

    let body_str = (!body.is_empty()).then(|| String::from_utf8_lossy(body).into_owned());

    if let Some(db) = ctx.db_ref() {
        match db.upsert_traffic_log(crate::storage::traffic::UpsertTrafficLogParams {
            id: ctx.request_id() as i64,
            method: ctx.method().as_str(),
            uri: &ctx.uri().to_string(),
            timestamp: crate::utils::date::now_ms(),
            headers_json: &ctx.headers_json(),
            query_json: &ctx.query_json(),
            body: body_str.as_deref(),
        }) {
            Ok(()) => ctx.set_db_id(ctx.request_id() as i64),
            Err(e) => log::warn!("[db] upsert_traffic_log: {e:?}"),
        }
    }

    let ai_body = body_str.clone();
    if let Some(chunk) = body_str {
        ctx.send(ProxyEvent::RequestChunk {
            id: ctx.request_id(),
            chunk,
        });
    }

    ai::request::process_ai_request(ctx, ai_body);
}

/// Log response and emit via channel. Takes ownership of [`ProxyCtx`]
/// (final use in the request lifecycle).
pub(crate) fn record_response(ctx: ProxyCtx, resp: Response) -> Response {
    let status = resp.status();
    info!("Response [{} {}] {}", ctx.method(), ctx.uri(), status);

    let resp_headers: HashMap<String, String> = collect_headers(resp.headers());
    let resp_content_type = resp_headers.get(header::CONTENT_TYPE.as_str()).cloned();

    let is_sse = resp_content_type
        .as_deref()
        .map(|ct| ct.to_ascii_lowercase().contains("text/event-stream"))
        .unwrap_or(false);

    let now_ms = crate::utils::date::now_ms();
    let duration_ms = (now_ms - ctx.start_ms()).max(0) as u64;

    ctx.send(ProxyEvent::Response {
        id: ctx.request_id(),
        status: status.as_u16(),
        timestamp: now_ms,
        duration_ms,
        headers: resp_headers.clone(),
        content_type: resp_content_type,
    });

    if let (Some(db), Some(db_id)) = (ctx.db_ref(), ctx.db_id()) {
        let h_json = map_to_kv_json(&resp_headers);
        db.update_traffic_response(db_id, status.as_u16(), now_ms, duration_ms, &h_json)
            .ok();
    }

    let method = ctx.method().to_string();
    let uri = ctx.uri().to_string();
    let request_id = ctx.request_id();
    let map_start = crate::utils::date::now_ms();
    let mapped = resp.map(|body| {
        let observer = ResponseObserver::new(ctx, status.as_u16(), is_sse);
        buf_pool::observe_body(body, observer)
    });
    info!(
        "resp.map took {}ms [{} {}] id={}",
        (crate::utils::date::now_ms() - map_start).max(0),
        method,
        uri,
        request_id
    );
    mapped
}

/// 非代理路径（resend 等）使用的便捷函数。
/// 复用 [`record_response`] 的 SSE 分帧 + Response 事件发射，
/// 然后驱动观测包装后的 body 完成消费，触发逐 chunk 的 ResponseChunk 推送。
pub(crate) async fn record_and_drain_response(ctx: ProxyCtx, resp: Response) -> u64 {
    let request_id = ctx.request_id();
    let resp = record_response(ctx, resp);
    let (_, body) = resp.into_parts();
    let _ = buf_pool::collect_body(body).await;
    request_id
}

// ══════════════════════════════════════════════════════════════════════════════
// ResponseObserver — 协调两个并行模块（录制 + AI 解析）
// ══════════════════════════════════════════════════════════════════════════════

/// 响应观测协调者。Proxy 录制和 AI 解析是两条并行的消费管线，
/// 各自拥有独立子状态。`on_chunk` / `on_eos` 只负责分发。
struct ResponseObserver {
    ctx: ProxyCtx,
    status: u16,
    finalized: bool,
    first_chunk_at: Option<i64>,
    recording: Recording,
    ai: Option<AiState>,
}

/// Proxy 录制子状态：发 ResponseChunk 事件 + DB 落库 + SSE 分帧。
struct Recording {
    db: Option<std::sync::Arc<crate::config::db::Db>>,
    db_id: Option<i64>,
    /// 非 SSE 时累积原始 body 文本，EOS 时消费。
    body_buf: Option<String>,
    framer: Option<SseFramer>,
    store_chunks: bool,
    chunk_seq: i64,
    chunk_bytes: usize,
}

impl ResponseObserver {
    fn new(ctx: ProxyCtx, status: u16, is_sse: bool) -> Self {
        let ai_req = ctx.ai_req();
        let db = ctx.db_ref().cloned();
        let ai_db = db.clone();
        let db_id = ctx.db_id();
        let needs_body_buf = db.is_some() && db_id.is_some() && !is_sse;

        let recording = Recording {
            db,
            db_id,
            body_buf: needs_body_buf.then(String::new),
            framer: is_sse.then(SseFramer::new),
            store_chunks: db_id.is_some() && is_sse,
            chunk_seq: 0,
            chunk_bytes: 0,
        };

        let request_delta = ctx.request_delta();

        let ai = ai_req.map(|(provider, session_id)| {
            AiState::new(
                provider,
                session_id,
                ctx.sessions().cloned(),
                ai_db,
                ctx.start_ms(),
                is_sse,
                request_delta,
            )
        });

        Self {
            ctx,
            status,
            finalized: false,
            first_chunk_at: None,
            recording,
            ai,
        }
    }
}

impl BodyObserver for ResponseObserver {
    fn on_chunk(&mut self, bytes: &Bytes) {
        self.first_chunk_at
            .get_or_insert(crate::utils::date::now_ms());

        if let Some(ref mut framer) = self.recording.framer {
            let events = framer.feed(bytes);
            if events.is_empty() {
                return;
            }
            self.recording
                .record_sse_events(self.ctx.request_id(), self.ctx.sender(), &events);
            if let Some(ref mut ai) = self.ai {
                ai.consume_sse(
                    &events,
                    self.ctx.request_id(),
                    self.first_chunk_at,
                    self.ctx.sender(),
                );
            }
        } else {
            let text = String::from_utf8_lossy(bytes).into_owned();
            if let Some(ch) = self.ctx.sender() {
                ch.send(ProxyEvent::ResponseChunk {
                    id: self.ctx.request_id(),
                    chunk: text.clone(),
                })
                .ok();
            }
            if let Some(ref mut buf) = self.recording.body_buf {
                buf_pool::push_capped(buf, &text);
            }
        }
    }

    fn on_end(&mut self, outcome: CaptureOutcome) {
        if self.finalized {
            return;
        }
        self.finalized = true;

        let terminated = terminated_reason(outcome);
        if let Some(reason) = terminated {
            log::warn!(
                "[traffic] response body terminated ({reason}) for request {}",
                self.ctx.request_id()
            );
            if let (Some(db), Some(db_id)) = (self.ctx.db_ref(), self.ctx.db_id()) {
                db.set_traffic_terminated(db_id, reason).ok();
            }
        }

        // finalize 必须排在 ResponseEnd 之前：它会 flush SSE framer 的残留帧并发出
        // 最后一个 ResponseChunk，否则前端会在「流已结束」之后又收到 chunk。
        let body_text = self
            .recording
            .finalize(self.ctx.request_id(), self.ctx.sender());

        self.ctx.send(ProxyEvent::ResponseEnd {
            id: self.ctx.request_id(),
            terminated: terminated.map(str::to_owned),
        });

        if let Some(ai) = self.ai.take() {
            ai.finalize(
                self.ctx.request_id(),
                self.status,
                self.first_chunk_at,
                self.ctx.sender(),
                body_text,
                terminated,
            );
        }
    }
}

/// 流终止原因 → 记录标记。`None` = 正常完成，不落标记。
///
/// `Aborted` 记为 `"aborted"`（下游未读完）而非 `"error"`：按 rama 语义它不必然
/// 意味着缺字节，不能断言数据被截断。
fn terminated_reason(outcome: CaptureOutcome) -> Option<&'static str> {
    match outcome {
        CaptureOutcome::Complete => None,
        CaptureOutcome::Error => Some("error"),
        CaptureOutcome::Aborted => Some("aborted"),
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Recording 方法
// ══════════════════════════════════════════════════════════════════════════════

impl Recording {
    fn record_sse_events(
        &mut self,
        request_id: u64,
        sender: &Option<Channel<ProxyEvent>>,
        events: &[SseEvent],
    ) {
        let now = crate::utils::date::now_ms();
        for evt in events {
            let text = format_sse_event(evt);

            if self.store_chunks
                && let (Some(db), Some(db_id)) = (self.db.as_ref(), self.db_id)
            {
                db.insert_chunk(db_id, &text, self.chunk_seq, now).ok();
                self.chunk_seq += 1;
                self.chunk_bytes += text.len();
                if self.chunk_bytes >= buf_pool::BODY_CAPTURE_LIMIT {
                    self.store_chunks = false;
                    log::warn!("[db] response_chunks capped for request {request_id}");
                }
            }

            if let Some(ch) = sender {
                ch.send(ProxyEvent::ResponseChunk {
                    id: request_id,
                    chunk: text,
                })
                .ok();
            }
        }
    }

    /// EOS 收尾：SSE framer 残留帧 + 非 SSE body 落库。
    /// 返回 body 文本供 AI 侧只读消费（AI 存在时）；无 AI 时返回 None。
    fn finalize(
        &mut self,
        request_id: u64,
        sender: &Option<Channel<ProxyEvent>>,
    ) -> Option<String> {
        if let Some(ref mut framer) = self.framer
            && let Some(ev) = framer.finalize()
        {
            self.record_sse_events(request_id, sender, &[ev]);
        }

        let body = self.body_buf.take().filter(|b| !b.is_empty());

        if let Some(ref body_text) = body
            && let (Some(db), Some(db_id)) = (self.db.as_ref(), self.db_id)
        {
            db.update_traffic_response_body(db_id, body_text).ok();
        }

        body
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// 工具函数
// ══════════════════════════════════════════════════════════════════════════════

/// SSE event → 原始文本重建（WHATWG 格式，与上游一致，供 DB + 前端消费）。
fn format_sse_event(evt: &SseEvent) -> String {
    let mut text = String::new();
    for comment in &evt.comments {
        text.push_str(&format!(": {comment}\n"));
    }
    if let Some(ref id) = evt.id {
        text.push_str(&format!("id: {id}\n"));
    }
    if let Some(ms) = evt.retry {
        text.push_str(&format!("retry: {ms}\n"));
    }
    if evt.event != "message" {
        text.push_str(&format!("event: {}\n", evt.event));
    }
    if let Some(ref data) = evt.data {
        for line in data.lines() {
            text.push_str(&format!("data: {line}\n"));
        }
    }
    text.push('\n');
    text
}
