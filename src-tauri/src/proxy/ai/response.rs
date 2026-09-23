use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tauri::ipc::Channel;

use crate::proxy::events::ProxyEvent;

use crate::config::db::Db;
use crate::storage::ai::{AiRequestFinalParams, AiSessionFinalParams, AiTurnInsert};

use super::normalize::{AiContentBlock, AiConversation, AiTimelineTurnDto, AiTurn, JsonValueExt};
use super::session::{SessionStore, TimelineEntry};
use super::{Provider, StreamState};

// ══════════════════════════════════════════════════════════════════════════════
// 常量
// ══════════════════════════════════════════════════════════════════════════════

/// 流式节流累积阈值（SSE data 累计字节数）；超过即推一次增量快照。
const AI_EMIT_THRESHOLD: usize = 160;
/// 非 JSON 响应 fallback 时的最大文本截取长度。
const AI_FALLBACK_TEXT_LIMIT: usize = 4096;

// ══════════════════════════════════════════════════════════════════════════════
// AiState
// ══════════════════════════════════════════════════════════════════════════════

/// AI 解析子状态：仅在请求命中 AI 检测规则时存在。
pub(crate) struct AiState {
    provider: Provider,
    session_id: String,
    sessions: Option<Arc<Mutex<SessionStore>>>,
    /// DB 连接（proxy 解密流量有；resend 等场景为 None），供响应侧入库。
    db: Option<Arc<Db>>,
    start_ms: i64,
    /// 流式状态机。`None` 表示非流式响应——EOS 时从完整 body 解析。
    stream_state: Option<Box<dyn StreamState>>,
    /// 覆盖率巡检：上游原始响应 JSON 的叶子字段名集合。
    raw_keys: HashSet<String>,
    /// 流式节流计数器（累计 SSE data 长度）；非流式恒为 0。
    stream_acc: usize,
    /// 请求侧增量 user turns（含 fingerprint），供时间线增量构造。
    request_delta: Vec<TimelineEntry>,
}

impl AiState {
    pub(crate) fn new(
        provider: Provider,
        session_id: String,
        sessions: Option<Arc<Mutex<SessionStore>>>,
        db: Option<Arc<Db>>,
        start_ms: i64,
        is_sse: bool,
        request_delta: Vec<TimelineEntry>,
    ) -> Self {
        let (stream_state, raw_keys, stream_acc) = if is_sse {
            (Some(provider.create_stream_state()), HashSet::new(), 0usize)
        } else {
            (None, HashSet::new(), 0usize)
        };
        Self {
            provider,
            session_id,
            sessions,
            db,
            start_ms,
            stream_state,
            raw_keys,
            stream_acc,
            request_delta,
        }
    }

    /// 本次请求的时间线增量：增量 user turns（含 fingerprint）+ 流式 assistant turns（无 fingerprint）。
    fn delta_turns(&self, request_id: u64, assistant: &[AiTurn]) -> Vec<AiTimelineTurnDto> {
        let mut turns: Vec<AiTimelineTurnDto> = self
            .request_delta
            .iter()
            .map(|e| AiTimelineTurnDto::committed(request_id, e.fingerprint, &e.turn))
            .collect();
        turns.extend(
            assistant
                .iter()
                .map(|t| AiTimelineTurnDto::streaming(request_id, t)),
        );
        turns
    }

    /// SSE 路径：消费分帧后的 events — JSON 解析 → 状态机驱动 → 节流快照。
    pub(crate) fn consume_sse(
        &mut self,
        events: &[crate::proxy::sse::SseEvent],
        request_id: u64,
        first_chunk_at: Option<i64>,
        sender: &Option<Channel<ProxyEvent>>,
    ) {
        let Some(ref mut state) = self.stream_state else {
            return;
        };
        for ev in events {
            if let Some(ref data) = ev.data
                && let Ok(value) = serde_json::from_str::<Value>(data)
            {
                self.raw_keys.extend(value.leaf_keys());
                state.apply(&ev.event, &value);
            }
        }
        self.stream_acc += sse_data_len(events);
        if self.stream_acc >= AI_EMIT_THRESHOLD {
            self.stream_acc = 0;
            let mut snap = state.snapshot();
            snap.start_ms = Some(self.start_ms);
            snap.first_chunk_ms = first_chunk_at.map(|at| (at - self.start_ms).max(0) as u64);
            let turns = self.delta_turns(request_id, &snap.turns);
            emit_ai_timeline(
                sender,
                &self.session_id,
                request_id,
                false,
                turns,
                &snap,
                None,
            );
        }
    }

    /// EOS 收尾：流式 finalize + 快照 / 非流式 JSON 解析 → 覆盖率 → emit + commit。
    /// `body_buf` 仅在非流式路径有效。
    /// `terminated` 非 `None` 表示流异常终止（`"error"` / `"aborted"`），此时不得
    /// 替上游补写终止符，也不得声称这是一次干净完成。
    pub(crate) fn finalize(
        self,
        request_id: u64,
        status: u16,
        first_chunk_at: Option<i64>,
        sender: &Option<Channel<ProxyEvent>>,
        body_buf: Option<String>,
        mut terminated: Option<&'static str>,
    ) {
        let (raw_keys, conv) = match self.stream_state {
            Some(mut state) => {
                // 传输层正常时交给 provider 定稿并汇报协议级终止原因（如没收到
                // `message_stop`、或中途 `event: error`）；传输层已异常
                // （error/aborted）则保留其 verdict，跳过 finalize。
                if terminated.is_none() {
                    terminated = state.finalize();
                }
                let mut snap = state.snapshot();
                // 各 provider 的 `streaming` 语义是「尚未收尾」（`!done`），跳过
                // finalize 后它会一直是 true。请求确实结束了——只是结束得不干净，
                // 由 `terminated` 表达，别让前端一直挂着流式光标。
                snap.streaming = false;
                snap.first_chunk_ms = first_chunk_at.map(|at| (at - self.start_ms).max(0) as u64);
                (Some(self.raw_keys), Some(snap))
            }
            None => {
                let buf = body_buf.unwrap_or_default();
                let (raw_keys, conv) = match serde_json::from_str::<Value>(&buf) {
                    Ok(root) => {
                        let raw_keys = root.leaf_keys();
                        let conv = self.provider.parse_response_body(&root).or_else(|| {
                            log::warn!(
                                "[ai] unparsed non-streaming body for request {request_id} \
                                 (status {status}, {} bytes)",
                                buf.len()
                            );
                            Some(fallback_conversation(
                                self.provider,
                                &buf,
                                status,
                                terminated,
                            ))
                        });
                        (Some(raw_keys), conv)
                    }
                    Err(e) => {
                        log::warn!(
                            "[ai] non-JSON response body for request {request_id} \
                             (status {status}, {} bytes): {e}",
                            buf.len()
                        );
                        (
                            None,
                            Some(fallback_conversation(
                                self.provider,
                                &buf,
                                status,
                                terminated,
                            )),
                        )
                    }
                };
                (raw_keys, conv)
            }
        };

        if let Some(mut conv) = conv {
            conv.start_ms = Some(self.start_ms);
            conv.duration_ms = Some((crate::utils::date::now_ms() - self.start_ms).max(0) as u64);

            // 覆盖率巡检
            if let Some(raw) = raw_keys {
                let ir_keys = serde_json::to_value(&conv)
                    .ok()
                    .map(|v| v.leaf_keys())
                    .unwrap_or_default();
                let mut uncovered: Vec<&str> =
                    raw.difference(&ir_keys).map(String::as_str).collect();
                uncovered.sort_unstable();
                if !uncovered.is_empty() {
                    log::info!(
                        "[ai-coverage] req#{} {} ({}) uncovered: {:?}",
                        request_id,
                        conv.model.as_deref().unwrap_or("-"),
                        conv.provider,
                        uncovered
                    );
                }
            }

            // 助理 turns 写入后端 SessionStore（供 prefix 匹配），并就地读全量
            // timeline 构造 finalize 快照（自愈：覆盖任何漏掉的流式增量）。
            let assistant_turns: Vec<AiTurn> = conv.turns.clone();
            let snapshot_turns: Vec<AiTimelineTurnDto> = match self.sessions.as_ref() {
                Some(sessions) => {
                    let mut store = sessions.lock().expect("sessions lock");
                    store.append_assistant_turns(&self.session_id, request_id, &assistant_turns);
                    store
                        .get(&self.session_id)
                        .map(|entry| {
                            entry
                                .timeline
                                .iter()
                                .map(|e| {
                                    AiTimelineTurnDto::committed(
                                        e.request_id,
                                        e.fingerprint,
                                        &e.turn,
                                    )
                                })
                                .collect()
                        })
                        .unwrap_or_default()
                }
                None => Vec::new(),
            };
            emit_ai_timeline(
                sender,
                &self.session_id,
                request_id,
                true,
                snapshot_turns,
                &conv,
                terminated,
            );
            commit_ai_final(sender, &self.sessions, request_id, &self.session_id, &conv);

            // 入库（响应侧）：请求元信息 + assistant turns + 会话 usage/title。
            if let (Some(db), Some(sessions)) = (&self.db, &self.sessions) {
                let now = crate::utils::date::now_ms();
                let usage = conv.usage.as_ref();
                let _ = db.update_ai_request_final(AiRequestFinalParams {
                    id: request_id as i64,
                    streaming: conv.streaming as i64,
                    model: conv.model.clone(),
                    finish_reason: conv.finish_reason.clone(),
                    terminated: terminated.map(str::to_owned),
                    first_chunk_ms: conv.first_chunk_ms.map(|v| v as i64),
                    duration_ms: conv.duration_ms.map(|v| v as i64),
                    input_tokens: usage.and_then(|u| u.input_tokens).map(|v| v as i64),
                    output_tokens: usage.and_then(|u| u.output_tokens).map(|v| v as i64),
                    total_tokens: usage.and_then(|u| u.total_tokens).map(|v| v as i64),
                    cached_tokens: usage.and_then(|u| u.cached_tokens).map(|v| v as i64),
                    cache_creation_tokens: usage
                        .and_then(|u| u.cache_creation_tokens)
                        .map(|v| v as i64),
                    reasoning_tokens: usage.and_then(|u| u.reasoning_tokens).map(|v| v as i64),
                });

                let inserts: Vec<AiTurnInsert> = assistant_turns
                    .iter()
                    .map(|t| AiTurnInsert {
                        session_id: self.session_id.clone(),
                        request_id: request_id as i64,
                        role: t.role.clone(),
                        fingerprint: super::session::turn_fingerprint(t) as i64,
                        content: serde_json::to_string(&t.content)
                            .unwrap_or_else(|_| "[]".to_string()),
                    })
                    .collect();
                let _ = db.insert_ai_turns(inserts);

                let (title, usage_total) = {
                    let store = sessions.lock().expect("sessions lock");
                    store
                        .get(&self.session_id)
                        .map(|e| (e.title.clone(), e.usage_total.clone()))
                        .unwrap_or_default()
                };
                let _ = db.update_ai_session_final(AiSessionFinalParams {
                    id: self.session_id.clone(),
                    title,
                    input_tokens: usage_total.input_tokens.map(|v| v as i64),
                    output_tokens: usage_total.output_tokens.map(|v| v as i64),
                    total_tokens: usage_total.total_tokens.map(|v| v as i64),
                    cached_tokens: usage_total.cached_tokens.map(|v| v as i64),
                    cache_creation_tokens: usage_total.cache_creation_tokens.map(|v| v as i64),
                    reasoning_tokens: usage_total.reasoning_tokens.map(|v| v as i64),
                    updated_at: now,
                });
            }
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// 公共辅助函数
// ══════════════════════════════════════════════════════════════════════════════

pub(crate) fn emit_ai_timeline(
    sender: &Option<Channel<ProxyEvent>>,
    session_id: &str,
    request_id: u64,
    snapshot: bool,
    turns: Vec<AiTimelineTurnDto>,
    conv: &AiConversation,
    terminated: Option<&str>,
) {
    if let Some(ch) = sender {
        let _ = ch.send(ProxyEvent::AiTimeline {
            session_id: session_id.to_string(),
            request_id,
            snapshot,
            turns,
            streaming: conv.streaming,
            model: conv.model.clone(),
            finish_reason: conv.finish_reason.clone(),
            terminated: terminated.map(str::to_owned),
            first_chunk_ms: conv.first_chunk_ms,
            duration_ms: conv.duration_ms,
            start_ms: conv.start_ms,
            usage: conv.usage.clone(),
        });
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// 内部辅助函数
// ══════════════════════════════════════════════════════════════════════════════

fn commit_ai_final(
    sender: &Option<Channel<ProxyEvent>>,
    sessions: &Option<Arc<Mutex<SessionStore>>>,
    request_id: u64,
    session_id: &str,
    conv: &AiConversation,
) {
    let Some(sessions) = sessions else {
        return;
    };
    let mut store = sessions.lock().expect("sessions lock");
    store.refine_title(session_id, request_id, conv);
    if let Some(usage) = conv.usage.as_ref() {
        store.add_usage(session_id, usage);
    }
    if let Some(entry) = store.get(session_id)
        && let Some(ch) = sender
    {
        let _ = ch.send(ProxyEvent::AiSession {
            session_id: session_id.to_string(),
            scope_host: entry.scope.1.clone(),
            request_ids: entry.request_ids.clone(),
            usage_total: entry.usage_total.clone(),
            match_reason: entry.match_reason.clone(),
            title: entry.title.clone(),
            source: entry.source.clone(),
        });
    }
}

/// 无法解析时的兜底会话：把 body 前缀当作 assistant 文本。
///
/// `terminated` 非 `None` 时不再合成 `http_<status>` 作为 finish_reason——流是断的，
/// 声称"以 status 收尾"就是把截断说成正常完成；真实终止原因由 `terminated` 携带。
fn fallback_conversation(
    provider: Provider,
    body: &str,
    status: u16,
    terminated: Option<&str>,
) -> AiConversation {
    let mut end = body.len().min(AI_FALLBACK_TEXT_LIMIT);
    while !body.is_char_boundary(end) {
        end -= 1;
    }
    AiConversation::new(
        provider.as_str(),
        vec![AiTurn::new(
            "assistant",
            vec![AiContentBlock::text(&body[..end])],
        )],
        false,
        None,
        None,
        terminated.is_none().then(|| format!("http_{status}")),
    )
}

/// SSE events 总 data 长度（用于节流计数）。
fn sse_data_len(events: &[crate::proxy::sse::SseEvent]) -> usize {
    events
        .iter()
        .map(|ev| ev.data.as_ref().map_or(0, |d| d.len()))
        .sum()
}
