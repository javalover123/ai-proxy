use std::collections::HashMap;
use std::sync::mpsc;

use serde::Serialize;

use crate::config::db::{Db, DbCmd};
use crate::proxy::ai::normalize::{AiContentBlock, AiTimelineTurnDto, AiTurn};
use crate::storage::{DbTable, add_column_if_missing};

// ── Table marker ──────────────────────────────────────────────────────────────

pub(crate) struct AiTable;

// ── Row structs（读，供启动重建会话表） ─────────────────────────────────────────

pub(crate) struct AiSessionRow {
    pub id: String,
    pub provider: String,
    pub host: String,
    pub title: Option<String>,
    pub source: Option<String>,
    pub match_reason: String,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub total_tokens: Option<i64>,
    pub cached_tokens: Option<i64>,
    pub cache_creation_tokens: Option<i64>,
    pub reasoning_tokens: Option<i64>,
    pub last_fingerprints: String,
    pub updated_at: i64,
}

pub(crate) struct AiRequestRow {
    pub id: i64,
    pub session_id: String,
}

pub(crate) struct AiTurnRow {
    pub session_id: String,
    pub request_id: i64,
    pub role: String,
    pub fingerprint: i64,
    pub content: String,
}

/// 全量快照，供启动时一次性重建内存会话表。
pub(crate) struct AiStoreSnapshot {
    pub sessions: Vec<AiSessionRow>,
    pub requests: Vec<AiRequestRow>,
    pub turns: Vec<AiTurnRow>,
}

// ── Write params ──────────────────────────────────────────────────────────────

pub(crate) struct UpsertAiSessionParams {
    pub id: String,
    pub provider: String,
    pub host: String,
    pub title: Option<String>,
    pub source: Option<String>,
    pub match_reason: String,
    pub last_fingerprints: String,
    pub created_at: i64,
    pub updated_at: i64,
}

pub(crate) struct AiTurnInsert {
    pub session_id: String,
    pub request_id: i64,
    pub role: String,
    pub fingerprint: i64,
    pub content: String,
}

pub(crate) struct AiRequestFinalParams {
    pub id: i64,
    pub streaming: i64,
    pub model: Option<String>,
    pub finish_reason: Option<String>,
    /// 代理侧观测到的异常终止（`error` / `aborted`），`None` = 正常收尾。
    pub terminated: Option<String>,
    pub first_chunk_ms: Option<i64>,
    pub duration_ms: Option<i64>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub total_tokens: Option<i64>,
    pub cached_tokens: Option<i64>,
    pub cache_creation_tokens: Option<i64>,
    pub reasoning_tokens: Option<i64>,
}

pub(crate) struct AiSessionFinalParams {
    pub id: String,
    pub title: Option<String>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub total_tokens: Option<i64>,
    pub cached_tokens: Option<i64>,
    pub cache_creation_tokens: Option<i64>,
    pub reasoning_tokens: Option<i64>,
    pub updated_at: i64,
}

// ── Query DTOs（返回前端，camelCase 与 src/types/ai.ts 对齐） ─────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiUsageDto {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) output_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) total_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) cached_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) cache_creation_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) reasoning_tokens: Option<u64>,
}

/// 单次请求的归一化元信息（不含 turns——turns 走 timeline 单独拉取）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiRequestMeta {
    pub(crate) id: i64,
    pub(crate) streaming: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) finish_reason: Option<String>,
    /// 代理侧观测到的异常终止（`error` / `aborted`），`None` = 正常收尾。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) terminated: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) first_chunk_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) duration_ms: Option<i64>,
    pub(crate) start_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) usage: Option<AiUsageDto>,
}

/// 会话摘要（列表用）：会话元信息 + 每请求元信息，不含 timeline turns。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiSessionSummary {
    pub(crate) session_id: String,
    pub(crate) scope_host: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) source: Option<String>,
    pub(crate) match_reason: String,
    pub(crate) request_ids: Vec<i64>,
    pub(crate) usage_total: AiUsageDto,
    pub(crate) requests: Vec<AiRequestMeta>,
}

fn usage_dto(
    input: Option<i64>,
    output: Option<i64>,
    total: Option<i64>,
    cached: Option<i64>,
    cache_creation: Option<i64>,
    reasoning: Option<i64>,
) -> AiUsageDto {
    AiUsageDto {
        input_tokens: input.map(|v| v as u64),
        output_tokens: output.map(|v| v as u64),
        total_tokens: total.map(|v| v as u64),
        cached_tokens: cached.map(|v| v as u64),
        cache_creation_tokens: cache_creation.map(|v| v as u64),
        reasoning_tokens: reasoning.map(|v| v as u64),
    }
}

// ── Db API（发消息到 writer thread） ───────────────────────────────────────────

impl Db {
    pub(crate) fn upsert_ai_session(&self, p: UpsertAiSessionParams) -> Result<(), sqlite::Error> {
        self.send(DbCmd::UpsertAiSession(p))
    }

    pub(crate) fn insert_ai_request(
        &self,
        id: i64,
        session_id: &str,
        start_ms: i64,
        created_at: i64,
    ) -> Result<(), sqlite::Error> {
        self.send(DbCmd::InsertAiRequest {
            id,
            session_id: session_id.to_string(),
            start_ms,
            created_at,
        })
    }

    pub(crate) fn insert_ai_turns(&self, turns: Vec<AiTurnInsert>) -> Result<(), sqlite::Error> {
        if turns.is_empty() {
            return Ok(());
        }
        self.send(DbCmd::InsertAiTurns { turns })
    }

    pub(crate) fn update_ai_request_final(
        &self,
        p: AiRequestFinalParams,
    ) -> Result<(), sqlite::Error> {
        self.send(DbCmd::UpdateAiRequestFinal(p))
    }

    pub(crate) fn update_ai_session_final(
        &self,
        p: AiSessionFinalParams,
    ) -> Result<(), sqlite::Error> {
        self.send(DbCmd::UpdateAiSessionFinal(p))
    }

    pub(crate) fn load_ai_store(&self) -> Result<AiStoreSnapshot, sqlite::Error> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.send(DbCmd::LoadAiStore { reply: reply_tx })?;
        reply_rx.recv().map_err(|_| sqlite::Error {
            code: None,
            message: Some("db writer thread disconnected".into()),
        })?
    }

    pub(crate) fn list_ai_sessions(&self) -> Result<Vec<AiSessionSummary>, sqlite::Error> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.send(DbCmd::ListAiSessions { reply: reply_tx })?;
        reply_rx.recv().map_err(|_| sqlite::Error {
            code: None,
            message: Some("db writer thread disconnected".into()),
        })?
    }

    pub(crate) fn get_ai_session(
        &self,
        session_id: &str,
    ) -> Result<Vec<AiTimelineTurnDto>, sqlite::Error> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.send(DbCmd::GetAiSession {
            session_id: session_id.to_string(),
            reply: reply_tx,
        })?;
        reply_rx.recv().map_err(|_| sqlite::Error {
            code: None,
            message: Some("db writer thread disconnected".into()),
        })?
    }

    pub(crate) fn get_ai_thinking(
        &self,
        session_id: &str,
        request_id: i64,
        fingerprint: i64,
    ) -> Result<Vec<String>, sqlite::Error> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.send(DbCmd::GetAiThinking {
            session_id: session_id.to_string(),
            request_id,
            fingerprint,
            reply: reply_tx,
        })?;
        reply_rx.recv().map_err(|_| sqlite::Error {
            code: None,
            message: Some("db writer thread disconnected".into()),
        })?
    }
}

// ── SQL operations（writer thread 调用） ───────────────────────────────────────

pub(crate) fn do_upsert_ai_session(
    conn: &sqlite::Connection,
    p: &UpsertAiSessionParams,
) -> Result<(), sqlite::Error> {
    let mut stmt = conn.prepare(
        "INSERT INTO ai_sessions
           (id, provider, host, title, source, match_reason, last_fingerprints, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           match_reason = excluded.match_reason,
           last_fingerprints = excluded.last_fingerprints,
           updated_at = excluded.updated_at",
    )?;
    stmt.bind((1_usize, p.id.as_str()))?;
    stmt.bind((2_usize, p.provider.as_str()))?;
    stmt.bind((3_usize, p.host.as_str()))?;
    stmt.bind((4_usize, p.title.as_deref()))?;
    stmt.bind((5_usize, p.source.as_deref()))?;
    stmt.bind((6_usize, p.match_reason.as_str()))?;
    stmt.bind((7_usize, p.last_fingerprints.as_str()))?;
    stmt.bind((8_usize, p.created_at))?;
    stmt.bind((9_usize, p.updated_at))?;
    stmt.next()?;
    Ok(())
}

pub(crate) fn do_insert_ai_request(
    conn: &sqlite::Connection,
    id: i64,
    session_id: &str,
    start_ms: i64,
    created_at: i64,
) -> Result<(), sqlite::Error> {
    let mut stmt = conn.prepare(
        "INSERT OR IGNORE INTO ai_requests (id, session_id, start_ms, created_at) VALUES (?, ?, ?, ?)",
    )?;
    stmt.bind((1_usize, id))?;
    stmt.bind((2_usize, session_id))?;
    stmt.bind((3_usize, start_ms))?;
    stmt.bind((4_usize, created_at))?;
    stmt.next()?;
    Ok(())
}

pub(crate) fn do_insert_ai_turns(
    conn: &sqlite::Connection,
    turns: &[AiTurnInsert],
) -> Result<(), sqlite::Error> {
    let mut stmt = conn.prepare(
        "INSERT INTO ai_turns (session_id, request_id, role, fingerprint, content) VALUES (?, ?, ?, ?, ?)",
    )?;
    for t in turns {
        stmt.bind((1_usize, t.session_id.as_str()))?;
        stmt.bind((2_usize, t.request_id))?;
        stmt.bind((3_usize, t.role.as_str()))?;
        stmt.bind((4_usize, t.fingerprint))?;
        stmt.bind((5_usize, t.content.as_str()))?;
        stmt.next()?;
        // 复用同一 statement：next() 返回 Done 后需 reset 才能再次 bind。
        stmt.reset()?;
    }
    Ok(())
}

pub(crate) fn do_update_ai_request_final(
    conn: &sqlite::Connection,
    p: &AiRequestFinalParams,
) -> Result<(), sqlite::Error> {
    let mut stmt = conn.prepare(
        "UPDATE ai_requests SET
           streaming = ?, model = ?, finish_reason = ?, terminated = ?, first_chunk_ms = ?, duration_ms = ?,
           input_tokens = ?, output_tokens = ?, total_tokens = ?, cached_tokens = ?, cache_creation_tokens = ?, reasoning_tokens = ?
         WHERE id = ?",
    )?;
    stmt.bind((1_usize, p.streaming))?;
    stmt.bind((2_usize, p.model.as_deref()))?;
    stmt.bind((3_usize, p.finish_reason.as_deref()))?;
    stmt.bind((4_usize, p.terminated.as_deref()))?;
    stmt.bind((5_usize, p.first_chunk_ms))?;
    stmt.bind((6_usize, p.duration_ms))?;
    stmt.bind((7_usize, p.input_tokens))?;
    stmt.bind((8_usize, p.output_tokens))?;
    stmt.bind((9_usize, p.total_tokens))?;
    stmt.bind((10_usize, p.cached_tokens))?;
    stmt.bind((11_usize, p.cache_creation_tokens))?;
    stmt.bind((12_usize, p.reasoning_tokens))?;
    stmt.bind((13_usize, p.id))?;
    stmt.next()?;
    Ok(())
}

pub(crate) fn do_update_ai_session_final(
    conn: &sqlite::Connection,
    p: &AiSessionFinalParams,
) -> Result<(), sqlite::Error> {
    let mut stmt = conn.prepare(
        "UPDATE ai_sessions SET
           title = COALESCE(?, title),
           input_tokens = ?, output_tokens = ?, total_tokens = ?, cached_tokens = ?, cache_creation_tokens = ?, reasoning_tokens = ?,
           updated_at = ?
         WHERE id = ?",
    )?;
    stmt.bind((1_usize, p.title.as_deref()))?;
    stmt.bind((2_usize, p.input_tokens))?;
    stmt.bind((3_usize, p.output_tokens))?;
    stmt.bind((4_usize, p.total_tokens))?;
    stmt.bind((5_usize, p.cached_tokens))?;
    stmt.bind((6_usize, p.cache_creation_tokens))?;
    stmt.bind((7_usize, p.reasoning_tokens))?;
    stmt.bind((8_usize, p.updated_at))?;
    stmt.bind((9_usize, p.id.as_str()))?;
    stmt.next()?;
    Ok(())
}

pub(crate) fn do_load_ai_store(
    conn: &sqlite::Connection,
) -> Result<AiStoreSnapshot, sqlite::Error> {
    let mut sessions = Vec::new();
    {
        let mut stmt = conn.prepare(
            "SELECT id, provider, host, title, source, match_reason,
                    input_tokens, output_tokens, total_tokens, cached_tokens, cache_creation_tokens,
                    last_fingerprints, updated_at, reasoning_tokens
             FROM ai_sessions",
        )?;
        while let sqlite::State::Row = stmt.next()? {
            sessions.push(AiSessionRow {
                id: stmt.read::<String, _>(0)?,
                provider: stmt.read::<String, _>(1)?,
                host: stmt.read::<String, _>(2)?,
                title: stmt.read::<Option<String>, _>(3)?,
                source: stmt.read::<Option<String>, _>(4)?,
                match_reason: stmt.read::<String, _>(5)?,
                input_tokens: stmt.read::<Option<i64>, _>(6)?,
                output_tokens: stmt.read::<Option<i64>, _>(7)?,
                total_tokens: stmt.read::<Option<i64>, _>(8)?,
                cached_tokens: stmt.read::<Option<i64>, _>(9)?,
                cache_creation_tokens: stmt.read::<Option<i64>, _>(10)?,
                last_fingerprints: stmt.read::<String, _>(11)?,
                updated_at: stmt.read::<i64, _>(12)?,
                reasoning_tokens: stmt.read::<Option<i64>, _>(13)?,
            });
        }
    }

    let mut requests = Vec::new();
    {
        let mut stmt = conn.prepare("SELECT id, session_id FROM ai_requests ORDER BY id")?;
        while let sqlite::State::Row = stmt.next()? {
            requests.push(AiRequestRow {
                id: stmt.read::<i64, _>(0)?,
                session_id: stmt.read::<String, _>(1)?,
            });
        }
    }

    let mut turns = Vec::new();
    {
        let mut stmt = conn.prepare(
            "SELECT session_id, request_id, role, fingerprint, content FROM ai_turns ORDER BY id",
        )?;
        while let sqlite::State::Row = stmt.next()? {
            turns.push(AiTurnRow {
                session_id: stmt.read::<String, _>(0)?,
                request_id: stmt.read::<i64, _>(1)?,
                role: stmt.read::<String, _>(2)?,
                fingerprint: stmt.read::<i64, _>(3)?,
                content: stmt.read::<String, _>(4)?,
            });
        }
    }

    Ok(AiStoreSnapshot {
        sessions,
        requests,
        turns,
    })
}

pub(crate) fn do_list_ai_sessions(
    conn: &sqlite::Connection,
) -> Result<Vec<AiSessionSummary>, sqlite::Error> {
    // ① 按会话聚合请求元信息（ORDER BY id = 到达序）
    let mut requests_by_session: HashMap<String, Vec<AiRequestMeta>> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT id, session_id, streaming, model, finish_reason, first_chunk_ms, duration_ms, start_ms,
                    input_tokens, output_tokens, total_tokens, cached_tokens, cache_creation_tokens, reasoning_tokens,
                    terminated
             FROM ai_requests ORDER BY id",
        )?;
        while let sqlite::State::Row = stmt.next()? {
            let session_id = stmt.read::<String, _>(1)?;
            let usage = usage_dto(
                stmt.read::<Option<i64>, _>(8)?,
                stmt.read::<Option<i64>, _>(9)?,
                stmt.read::<Option<i64>, _>(10)?,
                stmt.read::<Option<i64>, _>(11)?,
                stmt.read::<Option<i64>, _>(12)?,
                stmt.read::<Option<i64>, _>(13)?,
            );
            let meta = AiRequestMeta {
                id: stmt.read::<i64, _>(0)?,
                streaming: stmt.read::<Option<i64>, _>(2)?.unwrap_or(0) != 0,
                model: stmt.read::<Option<String>, _>(3)?,
                finish_reason: stmt.read::<Option<String>, _>(4)?,
                terminated: stmt.read::<Option<String>, _>(14)?,
                first_chunk_ms: stmt.read::<Option<i64>, _>(5)?,
                duration_ms: stmt.read::<Option<i64>, _>(6)?,
                start_ms: stmt.read::<i64, _>(7)?,
                usage: (!usage_is_empty(&usage)).then_some(usage),
            };
            requests_by_session
                .entry(session_id)
                .or_default()
                .push(meta);
        }
    }

    // ② 逐会话拼摘要（ORDER BY updated_at DESC = 最近活跃在前）
    let mut summaries = Vec::new();
    {
        let mut stmt = conn.prepare(
            "SELECT id, host, title, source, match_reason,
                    input_tokens, output_tokens, total_tokens, cached_tokens, cache_creation_tokens, reasoning_tokens
             FROM ai_sessions ORDER BY updated_at DESC",
        )?;
        while let sqlite::State::Row = stmt.next()? {
            let id = stmt.read::<String, _>(0)?;
            let requests = requests_by_session.remove(&id).unwrap_or_default();
            let request_ids = requests.iter().map(|r| r.id).collect();
            summaries.push(AiSessionSummary {
                session_id: id,
                scope_host: stmt.read::<String, _>(1)?,
                title: stmt.read::<Option<String>, _>(2)?,
                source: stmt.read::<Option<String>, _>(3)?,
                match_reason: stmt.read::<String, _>(4)?,
                request_ids,
                usage_total: usage_dto(
                    stmt.read::<Option<i64>, _>(5)?,
                    stmt.read::<Option<i64>, _>(6)?,
                    stmt.read::<Option<i64>, _>(7)?,
                    stmt.read::<Option<i64>, _>(8)?,
                    stmt.read::<Option<i64>, _>(9)?,
                    stmt.read::<Option<i64>, _>(10)?,
                ),
                requests,
            });
        }
    }

    Ok(summaries)
}

pub(crate) fn do_get_ai_session(
    conn: &sqlite::Connection,
    session_id: &str,
) -> Result<Vec<AiTimelineTurnDto>, sqlite::Error> {
    let mut turns = Vec::new();
    let mut stmt = conn.prepare(
        "SELECT request_id, role, fingerprint, content FROM ai_turns WHERE session_id = ? ORDER BY id",
    )?;
    stmt.bind((1_usize, session_id))?;
    while let sqlite::State::Row = stmt.next()? {
        let content_raw = stmt.read::<String, _>(3)?;
        let content: Vec<AiContentBlock> = serde_json::from_str(&content_raw).unwrap_or_default();
        let turn = AiTurn {
            role: stmt.read::<String, _>(1)?,
            content,
        };
        turns.push(AiTimelineTurnDto::committed(
            stmt.read::<i64, _>(0)? as u64,
            stmt.read::<i64, _>(2)? as u64,
            &turn,
        ));
    }
    Ok(turns)
}

/// 读取某 turn 的 thinking 正文（按出现顺序）。turn 由 (session_id, request_id, fingerprint) 定位。
pub(crate) fn do_get_ai_thinking(
    conn: &sqlite::Connection,
    session_id: &str,
    request_id: i64,
    fingerprint: i64,
) -> Result<Vec<String>, sqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT content FROM ai_turns WHERE session_id = ? AND request_id = ? AND fingerprint = ? ORDER BY id LIMIT 1",
    )?;
    stmt.bind((1_usize, session_id))?;
    stmt.bind((2_usize, request_id))?;
    stmt.bind((3_usize, fingerprint))?;
    let mut out = Vec::new();
    if let sqlite::State::Row = stmt.next()? {
        let content_raw = stmt.read::<String, _>(0)?;
        if let Ok(content) = serde_json::from_str::<Vec<AiContentBlock>>(&content_raw) {
            for block in content {
                if let AiContentBlock::Thinking { text } = block {
                    out.push(text);
                }
            }
        }
    }
    Ok(out)
}

/// usage 是否全空（所有字段 None）；全空时不序列化 usage 字段，避免前端误判有值。
fn usage_is_empty(u: &AiUsageDto) -> bool {
    u.input_tokens.is_none()
        && u.output_tokens.is_none()
        && u.total_tokens.is_none()
        && u.cached_tokens.is_none()
        && u.cache_creation_tokens.is_none()
        && u.reasoning_tokens.is_none()
}

// ── Migration ─────────────────────────────────────────────────────────────────

impl DbTable for AiTable {
    fn migrate(conn: &sqlite::Connection) -> Result<(), sqlite::Error> {
        conn.execute(
            "CREATE TABLE IF NOT EXISTS ai_sessions (
                id                     TEXT PRIMARY KEY,
                provider               TEXT NOT NULL,
                host                   TEXT NOT NULL,
                title                  TEXT,
                source                 TEXT,
                match_reason           TEXT NOT NULL,
                input_tokens           INTEGER,
                output_tokens          INTEGER,
                total_tokens           INTEGER,
                cached_tokens          INTEGER,
                cache_creation_tokens  INTEGER,
                reasoning_tokens       INTEGER,
                last_fingerprints      TEXT NOT NULL DEFAULT '[]',
                created_at             INTEGER NOT NULL,
                updated_at             INTEGER NOT NULL
            )",
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS ai_requests (
                id                     INTEGER PRIMARY KEY,
                session_id             TEXT NOT NULL,
                streaming              INTEGER,
                model                  TEXT,
                finish_reason          TEXT,
                first_chunk_ms         INTEGER,
                duration_ms            INTEGER,
                start_ms               INTEGER NOT NULL,
                input_tokens           INTEGER,
                output_tokens          INTEGER,
                total_tokens           INTEGER,
                cached_tokens          INTEGER,
                cache_creation_tokens  INTEGER,
                reasoning_tokens       INTEGER,
                terminated             TEXT,
                created_at             INTEGER NOT NULL
            )",
        )?;

        // 旧库迁移：terminated 列（响应流异常终止标记）在此列引入前建的库里不存在
        add_column_if_missing(conn, "ai_requests", "terminated", "TEXT")?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS ai_turns (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id    TEXT NOT NULL,
                request_id    INTEGER NOT NULL,
                role          TEXT NOT NULL,
                fingerprint   INTEGER NOT NULL,
                content       TEXT NOT NULL
            )",
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_ai_sessions_updated ON ai_sessions(updated_at DESC)",
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_ai_requests_session ON ai_requests(session_id, id)",
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_ai_turns_session ON ai_turns(session_id, id)",
        )?;

        Ok(())
    }
}
