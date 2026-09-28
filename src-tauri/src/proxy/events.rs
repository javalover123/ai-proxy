use serde::Serialize;
use std::collections::HashMap;

use crate::proxy::ai::{AiTimelineTurnDto, AiUsage};

/// Tagged union sent through the IPC Channel.
/// Frontend dispatches on `type` (serialized as snake_case).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum ProxyEvent {
    Request {
        id: u64,
        method: String,
        uri: String,
        timestamp: i64,
        headers: HashMap<String, String>,
        query_params: HashMap<String, String>,
        decrypted: bool,
        content_type: Option<String>,
    },
    RequestChunk {
        id: u64,
        chunk: String,
    },
    Response {
        id: u64,
        status: u16,
        timestamp: i64,
        duration_ms: u64,
        headers: HashMap<String, String>,
        content_type: Option<String>,
    },
    ResponseChunk {
        id: u64,
        chunk: String,
    },
    /// 响应流终止。`terminated` 缺省表示正常 EOS；否则为终止原因
    /// （`error` = 上游流中途出错，body 残缺；`aborted` = 下游未读完就断开）。
    ResponseEnd {
        id: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        terminated: Option<String>,
    },
    Error {
        id: u64,
        error: String,
    },
    /// extAuthz 授权拒绝（请求被外部授权服务拦下，不落库、不转发）。
    /// 前端据此合成一条实时列表条目，与正常 Request/Response 区分呈现。
    Denied {
        id: u64,
        method: String,
        uri: String,
        timestamp: i64,
        headers: HashMap<String, String>,
        query_params: HashMap<String, String>,
        decrypted: bool,
        status: u16,
        reason: String,
    },
    /// 时间线事件：delta（流式/请求侧增量）或 snapshot（finalize 整条快照）。
    /// 前端不再做 LCP 去重：snapshot 整体替换，delta 按「移除本次 request_id 的
    /// 旧条目 + 追加」机械应用。turns 内 thinking 正文已剥（按需 get_ai_thinking）。
    AiTimeline {
        session_id: String,
        request_id: u64,
        /// true = 整条去重 timeline 快照；false = 本次请求的增量 turns。
        snapshot: bool,
        turns: Vec<AiTimelineTurnDto>,
        /// 本次请求元信息（流式阶段 finish_reason/duration_ms/usage 缺省）。
        streaming: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        model: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        finish_reason: Option<String>,
        /// 代理侧观测到的异常终止（`error` / `aborted`）。与 `finish_reason` 分开：
        /// 后者只装上游说的话，截断时上游本就没说。
        #[serde(skip_serializing_if = "Option::is_none")]
        terminated: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        first_chunk_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        start_ms: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        usage: Option<AiUsage>,
    },
    /// 会话元信息。会话新增请求或 usage 变化时推送。
    AiSession {
        session_id: String,
        scope_host: String,
        request_ids: Vec<u64>,
        usage_total: AiUsage,
        /// 归组依据：`header:<name>` / `prefix` / `new`。
        match_reason: String,
        /// 会话标题：来自首请求响应的 `{"title": "..."}`，无则缺省。
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        /// 来源归属：规则内 (来源, 合并头) 对的头命中时为对应来源名，无则缺省。
        #[serde(skip_serializing_if = "Option::is_none")]
        source: Option<String>,
    },
}
