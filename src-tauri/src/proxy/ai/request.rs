use crate::config::AiRuleSource;
use crate::proxy::ctx::ProxyCtx;
use crate::proxy::events::ProxyEvent;
use crate::storage::ai::{AiTurnInsert, UpsertAiSessionParams};

use super::{AiTimelineTurnDto, Provider};

/// 请求侧 AI 管线入口：provider 判定 → 请求归一化 → 会话分组 → 前端推送。
/// `body_str` 由调用方 clone 传入，内部消费，不产生额外分配。
pub(crate) fn process_ai_request(ctx: &ProxyCtx, body_str: Option<String>) {
    // AI 检测总开关关闭 / body 为空 → 完全跳过。
    let Some(body_str) = body_str else {
        return;
    };
    if !ctx.settings().ai.enabled {
        return;
    }
    let host = ctx.host_str();

    // 非 AI 流量（未命中 URL 规则）直接跳过，零开销。
    let (ai_hint, sources) = ctx
        .settings()
        .ai
        .detection
        .compute_hint(&host, &ctx.uri().path_or_root());
    let Some(provider) = ai_hint.map(Provider::from) else {
        return;
    };
    let Some(sessions) = ctx.sessions() else {
        return;
    };

    let root: serde_json::Value = match serde_json::from_str(&body_str) {
        Ok(v) => v,
        Err(_) => return,
    };
    let turns = provider.parse_request(&root);
    if turns.is_empty() {
        return;
    }

    let cfg = &ctx.settings().ai.session;

    // 分组 + 会话快照一次锁内完成（AssignResult 自带快照，免二次加锁读表）。
    let session_headers = session_header_list(&sources, &cfg.session_headers);
    let result = {
        let mut store = sessions.lock().expect("sessions lock");
        store.assign(super::session::AssignParams {
            provider,
            host: &host,
            session_headers: &session_headers,
            headers: ctx.header_map(),
            messages: &turns,
            prefix_fallback: cfg.prefix_match_fallback,
            request_id: ctx.request_id(),
        })
    };

    // 登记 (provider, session_id) 供响应侧使用。
    ctx.set_ai_req(provider, result.session_id.clone());

    // 本次请求的增量 user turns（含 fingerprint）存入 ctx，供响应侧构造时间线增量。
    ctx.set_ai_request_delta(result.delta.clone());

    // 入库（请求侧）：会话 + 请求 + user-turn 增量。resend 等无 DB 路径跳过。
    if let Some(db) = ctx.db_ref() {
        let now = crate::utils::date::now_ms();
        let last_fp =
            serde_json::to_string(&result.last_fingerprints).unwrap_or_else(|_| "[]".to_string());
        let _ = db.upsert_ai_session(UpsertAiSessionParams {
            id: result.session_id.clone(),
            provider: provider.as_str().to_string(),
            host: host.clone(),
            title: result.title.clone(),
            source: result.source.clone(),
            match_reason: result.match_reason.clone(),
            last_fingerprints: last_fp,
            created_at: now,
            updated_at: now,
        });
        let _ = db.insert_ai_request(
            ctx.request_id() as i64,
            &result.session_id,
            ctx.start_ms(),
            now,
        );
        let inserts: Vec<AiTurnInsert> = result
            .delta
            .iter()
            .map(|e| AiTurnInsert {
                session_id: result.session_id.clone(),
                request_id: e.request_id as i64,
                role: e.turn.role.clone(),
                fingerprint: e.fingerprint as i64,
                content: serde_json::to_string(&e.turn.content)
                    .unwrap_or_else(|_| "[]".to_string()),
            })
            .collect();
        let _ = db.insert_ai_turns(inserts);
    }

    ctx.send(ProxyEvent::AiSession {
        session_id: result.session_id.clone(),
        scope_host: host,
        request_ids: result.request_ids,
        usage_total: result.usage_total,
        match_reason: result.match_reason,
        title: result.title,
        source: result.source,
    });

    // 请求侧推本次请求的增量 user turns（时间线 delta），用户消息即时上屏。
    let delta_turns: Vec<AiTimelineTurnDto> = result
        .delta
        .iter()
        .map(|e| AiTimelineTurnDto::committed(ctx.request_id(), e.fingerprint, &e.turn))
        .collect();
    ctx.send(ProxyEvent::AiTimeline {
        session_id: result.session_id,
        request_id: ctx.request_id(),
        snapshot: false,
        turns: delta_turns,
        streaming: false,
        model: None,
        finish_reason: None,
        first_chunk_ms: None,
        duration_ms: None,
        start_ms: Some(ctx.start_ms()),
        usage: None,
    });
}

/// 会话合并 header 尝试名单：规则各来源的 merge_header 在前（保序、去空白、
/// 大小写去重，附带来源名供命中归属），全局名单在后（无来源名，对前者去重）。
/// 来源名空白时该头仍参与分组，只是不产生归属。
fn session_header_list(
    sources: &[AiRuleSource],
    global: &[String],
) -> Vec<(String, Option<String>)> {
    let mut list: Vec<(String, Option<String>)> = Vec::with_capacity(sources.len() + global.len());
    for s in sources {
        let header = s.merge_header.trim();
        if header.is_empty() || list.iter().any(|(h, _)| h.eq_ignore_ascii_case(header)) {
            continue;
        }
        let name = s.name.trim();
        list.push((
            header.to_string(),
            (!name.is_empty()).then(|| name.to_string()),
        ));
    }
    for g in global {
        if !list.iter().any(|(h, _)| h.eq_ignore_ascii_case(g)) {
            list.push((g.clone(), None));
        }
    }
    list
}
