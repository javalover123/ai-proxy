use crate::proxy::ai::AiTimelineTurnDto;
use crate::proxy::state::AppState;
use crate::storage::ai::{AiSessionSummary, AiUsageSummary};

/// 列出所有 AI 会话摘要（元信息 + 每请求元信息，不含 timeline turns）。
/// 前端启动时拉取一次，历史会话据此恢复；turns 按需经 `get_ai_session` 拉取。
#[tauri::command]
pub async fn list_ai_sessions(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<AiSessionSummary>, String> {
    state
        .db()
        .list_ai_sessions()
        .map_err(|e| format!("db: {e:?}"))
}

/// 拉取某会话的去重 timeline（含 turn 内容），供前端渲染对话。
#[tauri::command]
pub async fn get_ai_session(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Vec<AiTimelineTurnDto>, String> {
    state
        .db()
        .get_ai_session(&session_id)
        .map_err(|e| format!("db: {e:?}"))
}

/// 按需拉取某 turn 的 thinking 正文（turn 由 requestId + fingerprint 定位）。
#[tauri::command]
pub async fn get_ai_thinking(
    state: tauri::State<'_, AppState>,
    session_id: String,
    request_id: i64,
    fingerprint: i64,
) -> Result<Vec<String>, String> {
    state
        .db()
        .get_ai_thinking(&session_id, request_id, fingerprint)
        .map_err(|e| format!("db: {e:?}"))
}

/// 汇总 [start_ms, end_ms) 区间内的请求数与 token 用量（期间筛选统计面板用）。
#[tauri::command]
pub async fn get_ai_usage_summary(
    state: tauri::State<'_, AppState>,
    start_ms: i64,
    end_ms: i64,
) -> Result<AiUsageSummary, String> {
    state
        .db()
        .get_ai_usage_summary(start_ms, end_ms)
        .map_err(|e| format!("db: {e:?}"))
}
