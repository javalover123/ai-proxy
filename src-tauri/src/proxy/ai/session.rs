//! 跨请求会话分组。
//!
//! 归一化的副产品：请求归一化时 messages 与 headers 都在手，就地判定会话归属。
//! - 范围（scope）= provider + 上游 host，只在同一 scope 内分组；
//! - 会话区分：① 配置的 session header 值优先 → ② 消息前缀匹配兜底 → ③ 新会话；
//! - token 简单累加；会话表内存 + LRU 上限；不持久化。

use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};

use serde::Serialize;
use uuid::Uuid;

use super::Provider;
use super::normalize::{AiContentBlock, AiConversation, AiTurn, AiUsage};

/// 单会话内存 timeline 上限（与前端历史一致，防止长会话下内存与 finalize 快照无界增长）。
const MAX_TIMELINE: usize = 500;

/// 会话时间线中的一条记录。fingerprint 供 LCP 快速比较，turn 为完整内容。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TimelineEntry {
    pub fingerprint: u64,
    pub turn: AiTurn,
    pub request_id: u64,
}

/// 一个会话的内存状态。
pub(crate) struct SessionEntry {
    pub id: String,
    pub scope: (String, String),
    pub request_ids: Vec<u64>,
    /// 供前缀匹配用：该会话最近一次请求各 turn 的指纹链（不含响应 turn）。
    /// 前缀匹配只需相等性判定，无需原文——每 turn 一个哈希，
    /// 内存 O(轮次) 而非 O(内容)，比较为 u64 切片比较。
    pub last_fingerprints: Vec<u64>,
    /// 已合并的时间线：所有请求 deltas 的累积，前端直接 append 即可渲染。
    pub timeline: Vec<TimelineEntry>,
    pub usage_total: AiUsage,
    /// 会话标题：来自首请求响应的 `{"title": "..."}`（见 normalize::extract_title）。
    pub title: Option<String>,
    /// 来源归属：规则内 (来源, 合并头) 对的头命中时写入对应来源名；
    /// 全局名单命中或前缀/新会话为 None。前缀续轮不清除已有归属。
    pub source: Option<String>,
    /// 归组依据：`header:<name>` / `prefix` / `new`。随每次 assign 更新，
    /// 供 usage 更新事件回传，避免覆盖为 "usage"。
    pub match_reason: String,
    /// LRU 序号，越大越新。
    pub last_touched: u64,
}

/// 分组结果 + 会话快照。快照与分组在同一次锁内读取，
/// 调用方构造 `AiSession` 事件无需二次加锁。
pub(crate) struct AssignResult {
    pub session_id: String,
    /// 归组依据：`header:<name>` / `prefix` / `new`。
    pub match_reason: String,
    pub request_ids: Vec<u64>,
    pub usage_total: AiUsage,
    pub title: Option<String>,
    /// 会话来源归属（见 [`SessionEntry::source`]）。
    pub source: Option<String>,
    /// 本次新增的 user-turn 时间线条目（供入库）。
    pub delta: Vec<TimelineEntry>,
    /// 本次请求的完整指纹链（供入库 last_fingerprints）。
    pub last_fingerprints: Vec<u64>,
}

pub(crate) struct AssignParams<'a> {
    pub provider: Provider,
    pub host: &'a str,
    pub session_headers: &'a [(String, Option<String>)],
    pub headers: &'a HashMap<String, String>,
    pub messages: &'a [AiTurn],
    pub prefix_fallback: bool,
    pub request_id: u64,
}

struct TouchParams<'a> {
    sid: &'a str,
    scope: &'a (String, String),
    fingerprints: &'a [u64],
    request_id: u64,
    tick: u64,
    source: Option<&'a str>,
    match_reason: &'a str,
    messages: &'a [AiTurn],
}

/// 会话状态表。挂在 `State` 上，`Arc<Mutex<..>>` 包裹以线程安全。
pub(crate) struct SessionStore {
    sessions: HashMap<String, SessionEntry>,
    max_sessions: usize,
    tick: u64,
}

impl SessionStore {
    pub(crate) fn new(max_sessions: usize) -> Self {
        SessionStore {
            sessions: HashMap::new(),
            max_sessions: max_sessions.max(1),
            tick: 0,
        }
    }

    fn next_tick(&mut self) -> u64 {
        self.tick += 1;
        self.tick
    }

    /// 判定请求归属并登记。返回会话 id、归组依据与会话快照。
    ///
    /// - `session_headers`：(header, 该头所属来源名) 尝试名单（规则来源对在前、
    ///   全局名单在后，见 request::session_header_list），按顺序取第一个命中；
    ///   命中带来源名的头即把会话归属该来源；
    /// - `headers`：本次请求头（键为小写，来自 rama `HeaderName`）；
    /// - `messages`：本次请求归一化后的 turns（用于前缀匹配与更新指纹链）；
    /// - `prefix_fallback`：无 header 时是否启用前缀匹配。
    pub(crate) fn assign(&mut self, p: AssignParams<'_>) -> AssignResult {
        let scope = (p.provider.as_str().to_string(), p.host.to_string());
        let tick = self.next_tick();
        let fingerprints: Vec<u64> = p.messages.iter().map(turn_fingerprint).collect();

        // ① header 优先：按名单顺序取第一个命中，会话 id = scope + header 值
        for (name, source) in p.session_headers {
            if let Some(val) = p.headers.get(&name.to_ascii_lowercase()) {
                let sid = session_key(&scope, val);
                let reason = format!("header:{name}");
                let delta = self.touch_or_create(TouchParams {
                    sid: &sid,
                    scope: &scope,
                    fingerprints: &fingerprints,
                    request_id: p.request_id,
                    tick,
                    source: source.as_deref(),
                    match_reason: &reason,
                    messages: p.messages,
                });
                return self.result_snapshot(sid, reason, delta, fingerprints);
            }
        }

        // ② 前缀匹配兜底：同 scope 会话里找指纹链是本次前缀者，取最长
        if p.prefix_fallback {
            let mut best: Option<(String, usize)> = None;
            for entry in self.sessions.values() {
                if entry.scope != scope {
                    continue;
                }
                if is_prefix(&entry.last_fingerprints, &fingerprints) {
                    let len = entry.last_fingerprints.len();
                    if best.as_ref().map(|(_, l)| len > *l).unwrap_or(true) {
                        best = Some((entry.id.clone(), len));
                    }
                }
            }
            if let Some((sid, _)) = best {
                let delta = self.touch_or_create(TouchParams {
                    sid: &sid,
                    scope: &scope,
                    fingerprints: &fingerprints,
                    request_id: p.request_id,
                    tick,
                    source: None,
                    match_reason: "prefix",
                    messages: p.messages,
                });
                return self.result_snapshot(sid, "prefix".to_string(), delta, fingerprints);
            }
        }

        // ③ 新会话
        let sid = format!("sess-{}", Uuid::new_v4());
        let delta = self.touch_or_create(TouchParams {
            sid: &sid,
            scope: &scope,
            fingerprints: &fingerprints,
            request_id: p.request_id,
            tick,
            source: None,
            match_reason: "new",
            messages: p.messages,
        });
        self.result_snapshot(sid, "new".to_string(), delta, fingerprints)
    }

    /// 分组落定后就地读快照。新会话 tick 最大不会被 LRU 淘汰，entry 必然存在。
    fn result_snapshot(
        &self,
        session_id: String,
        match_reason: String,
        delta: Vec<TimelineEntry>,
        last_fingerprints: Vec<u64>,
    ) -> AssignResult {
        let entry = &self.sessions[&session_id];
        AssignResult {
            request_ids: entry.request_ids.clone(),
            usage_total: entry.usage_total.clone(),
            title: entry.title.clone(),
            source: entry.source.clone(),
            session_id,
            match_reason,
            delta,
            last_fingerprints,
        }
    }

    /// 更新/创建会话条目。timeline 保留 LCP 增量更新供 prefix 匹配，
    /// 前端从 AiNormalized.conversation 自包含消费。返回本次新增的
    /// 时间线条目（delta），供调用方入库。
    fn touch_or_create(&mut self, p: TouchParams<'_>) -> Vec<TimelineEntry> {
        match self.sessions.get_mut(p.sid) {
            Some(entry) => {
                if !entry.request_ids.contains(&p.request_id) {
                    entry.request_ids.push(p.request_id);
                }
                // 计算增量：LCP(timeline_fingerprints, new_fingerprints)
                let lcp = entry
                    .timeline
                    .iter()
                    .map(|e| e.fingerprint)
                    .zip(p.fingerprints.iter())
                    .take_while(|(a, b)| a == *b)
                    .count();
                let delta: Vec<TimelineEntry> = p.fingerprints[lcp..]
                    .iter()
                    .zip(&p.messages[lcp..])
                    .map(|(fp, turn)| TimelineEntry {
                        fingerprint: *fp,
                        turn: turn.clone(),
                        request_id: p.request_id,
                    })
                    .collect();
                // 追加到时间线
                entry.timeline.extend(delta.clone());
                trim_timeline(&mut entry.timeline);
                entry.last_fingerprints = p.fingerprints.to_vec();
                entry.last_touched = p.tick;
                entry.match_reason = p.match_reason.to_string();
                // 仅在本次确认了来源时覆写；前缀/全局命中（None）不清除已有归属
                if let Some(src) = p.source {
                    entry.source = Some(src.to_string());
                }
                delta
            }
            None => {
                // 新会话：全部 turns 都是增量
                let delta: Vec<TimelineEntry> = p
                    .messages
                    .iter()
                    .zip(p.fingerprints.iter())
                    .map(|(turn, fp)| TimelineEntry {
                        fingerprint: *fp,
                        turn: turn.clone(),
                        request_id: p.request_id,
                    })
                    .collect();
                // 仅新会话时从第一条 user turn 提取标题（兜底），
                // 后续由 refine_title 用响应 {"title": "..."} 覆盖
                let title = super::normalize::extract_title_from_request(p.messages);
                self.sessions.insert(
                    p.sid.to_string(),
                    SessionEntry {
                        id: p.sid.to_string(),
                        scope: p.scope.clone(),
                        request_ids: vec![p.request_id],
                        last_fingerprints: p.fingerprints.to_vec(),
                        timeline: delta.clone(),
                        usage_total: AiUsage::default(),
                        title,
                        source: p.source.map(str::to_string),
                        match_reason: p.match_reason.to_string(),
                        last_touched: p.tick,
                    },
                );
                self.evict_if_needed();
                delta
            }
        }
    }

    /// 把某请求的 usage 累加到其所属会话。
    pub(crate) fn add_usage(&mut self, session_id: &str, usage: &AiUsage) {
        if let Some(entry) = self.sessions.get_mut(session_id) {
            entry.usage_total.accumulate(usage);
        }
    }

    /// 首请求响应定稿时，尝试用 `{"title": "..."}`（模型生成标题）
    /// 覆盖 `assign` 阶段从用户消息提取的兜底标题。
    /// 非首请求的响应不操作（会话标题由首次交互定义）。
    pub(crate) fn refine_title(
        &mut self,
        session_id: &str,
        request_id: u64,
        conv: &AiConversation,
    ) {
        let Some(entry) = self.sessions.get_mut(session_id) else {
            return;
        };
        // 仅首请求的响应参与标题命名
        if entry.request_ids.first().copied() != Some(request_id) {
            return;
        }
        // 响应有 {"title":"..."} → 覆盖（比用户原始输入更精炼）
        if let Some(title) = super::normalize::extract_title(conv) {
            entry.title = Some(title);
        }
    }

    /// 将 assistant turn 追加到会话时间线（响应定稿时调用），
    /// 供 prefix 匹配使用，不再推送前端。
    pub(crate) fn append_assistant_turns(
        &mut self,
        session_id: &str,
        request_id: u64,
        turns: &[AiTurn],
    ) {
        let Some(entry) = self.sessions.get_mut(session_id) else {
            return;
        };
        let entries: Vec<TimelineEntry> = turns
            .iter()
            .map(|turn| TimelineEntry {
                fingerprint: turn_fingerprint(turn),
                turn: turn.clone(),
                request_id,
            })
            .collect();
        entry.timeline.extend(entries);
        trim_timeline(&mut entry.timeline);
    }

    /// 读取会话快照（供构造 AiSession 事件）。
    pub(crate) fn get(&self, session_id: &str) -> Option<&SessionEntry> {
        self.sessions.get(session_id)
    }

    /// 超出上限时按 LRU（last_touched 最小）淘汰。
    fn evict_if_needed(&mut self) {
        while self.sessions.len() > self.max_sessions {
            let Some(victim) = self
                .sessions
                .values()
                .min_by_key(|e| e.last_touched)
                .map(|e| e.id.clone())
            else {
                break;
            };
            self.sessions.remove(&victim);
            log::info!("[ai-session] evicted LRU session {victim}");
        }
    }

    /// 启动时从 DB 重建会话表，让会话分组与时间线跨重启连续。
    /// 读取失败回退为空表（历史仍可读，前缀匹配从空开始）。
    pub(crate) fn load(db: &crate::config::db::Db, max_sessions: usize) -> Self {
        match db.load_ai_store() {
            Ok(snapshot) => Self::from_snapshot(snapshot, max_sessions),
            Err(e) => {
                log::warn!("[ai-session] load from db failed: {e:?}, starting empty");
                SessionStore::new(max_sessions)
            }
        }
    }

    fn from_snapshot(snapshot: crate::storage::ai::AiStoreSnapshot, max_sessions: usize) -> Self {
        let mut sessions: HashMap<String, SessionEntry> = HashMap::new();
        let mut max_tick: u64 = 0;

        for row in snapshot.sessions {
            let last_fingerprints: Vec<u64> =
                serde_json::from_str(&row.last_fingerprints).unwrap_or_default();
            let usage_total = AiUsage {
                input_tokens: row.input_tokens.map(|v| v as u64),
                output_tokens: row.output_tokens.map(|v| v as u64),
                total_tokens: row.total_tokens.map(|v| v as u64),
                cached_tokens: row.cached_tokens.map(|v| v as u64),
                cache_creation_tokens: row.cache_creation_tokens.map(|v| v as u64),
                reasoning_tokens: row.reasoning_tokens.map(|v| v as u64),
            };
            let last_touched = row.updated_at.max(0) as u64;
            max_tick = max_tick.max(last_touched);
            sessions.insert(
                row.id.clone(),
                SessionEntry {
                    id: row.id,
                    scope: (row.provider, row.host),
                    request_ids: Vec::new(),
                    last_fingerprints,
                    timeline: Vec::new(),
                    usage_total,
                    title: row.title,
                    source: row.source,
                    match_reason: row.match_reason,
                    last_touched,
                },
            );
        }

        // request_ids：按 id 序（= 到达序）填充。
        for req in snapshot.requests {
            if let Some(entry) = sessions.get_mut(&req.session_id)
                && !entry.request_ids.contains(&(req.id as u64))
            {
                entry.request_ids.push(req.id as u64);
            }
        }

        // timeline：按 id 序（= 插入序）填充。
        for turn in snapshot.turns {
            let Some(entry) = sessions.get_mut(&turn.session_id) else {
                continue;
            };
            let Ok(content) = serde_json::from_str::<Vec<AiContentBlock>>(&turn.content) else {
                continue;
            };
            entry.timeline.push(TimelineEntry {
                fingerprint: turn.fingerprint as u64,
                turn: AiTurn {
                    role: turn.role,
                    content,
                },
                request_id: turn.request_id as u64,
            });
        }

        SessionStore {
            sessions,
            max_sessions: max_sessions.max(1),
            tick: max_tick,
        }
    }
}

fn session_key(scope: &(String, String), header_val: &str) -> String {
    format!("{}|{}|{}", scope.0, scope.1, header_val)
}

/// 单 turn 指纹：role + content（**忽略 thinking**）序列化文本的哈希。
/// 忽略 thinking 的原因：客户端回放历史时常剥掉思考内容，计入会让同一 turn
/// 前后形状不同，导致 LCP 断开、把历史当新数据重复入库/推送。
pub(crate) fn turn_fingerprint(turn: &AiTurn) -> u64 {
    let mut h = DefaultHasher::new();
    turn.role.hash(&mut h);
    // 仅哈希非 thinking 块；thinking 正文不参与等价判定。
    let comparable: Vec<&AiContentBlock> = turn
        .content
        .iter()
        .filter(|b| !matches!(b, AiContentBlock::Thinking { .. }))
        .collect();
    if let Ok(json) = serde_json::to_string(&comparable) {
        json.hash(&mut h);
    }
    // 截断到 53 位：该值会作为前端 turn id 走 JSON，>2^53 在 JS Number 中丢精度。
    h.finish() & ((1u64 << 53) - 1)
}

/// `prev` 是否为 `curr` 的非空前缀（逐 turn 指纹比较）。
pub(crate) fn is_prefix(prev: &[u64], curr: &[u64]) -> bool {
    !prev.is_empty() && prev.len() <= curr.len() && prev == &curr[..prev.len()]
}

/// 截断 timeline 到上限（保留最新 MAX_TIMELINE 条，丢弃最旧）。
fn trim_timeline(timeline: &mut Vec<TimelineEntry>) {
    if timeline.len() > MAX_TIMELINE {
        let excess = timeline.len() - MAX_TIMELINE;
        timeline.drain(0..excess);
    }
}
