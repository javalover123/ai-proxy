use std::collections::HashMap;
use std::sync::mpsc;

use crate::storage::{DbTable, add_column_if_missing};
use serde::Serialize;

// ── Table marker ──────────────────────────────────────────────────────────────

pub(crate) struct TrafficTable;

/// A row / serialisable entry for the `traffic_logs` table.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct TrafficLogEntry {
    pub id: u64,
    pub method: String,
    pub uri: String,
    #[serde(rename = "requestTimestamp")]
    pub request_timestamp: i64,
    #[serde(rename = "requestHeaders")]
    pub request_headers: HashMap<String, String>,
    #[serde(rename = "requestBody")]
    pub request_body: Option<String>,
    #[serde(rename = "requestQuery")]
    pub request_query: Option<HashMap<String, String>>,
    pub status: Option<u16>,
    #[serde(rename = "responseTimestamp")]
    pub response_timestamp: Option<i64>,
    #[serde(rename = "durationMs")]
    pub duration_ms: Option<u64>,
    #[serde(rename = "responseHeaders")]
    pub response_headers: Option<HashMap<String, String>>,
    #[serde(rename = "responseBody")]
    pub response_body: Option<String>,
    pub error: Option<String>,
    /// 响应流的异常终止原因（`error` / `aborted`）。`None` = 正常 EOS。
    /// 与 `error` 分开：`error` 表示整个请求失败（无响应），`terminated` 表示
    /// 响应头已返回、但 body 没走完。
    pub terminated: Option<String>,
    #[serde(rename = "responseChunks", default)]
    pub response_chunks: Vec<ChunkRecord>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct ChunkRecord {
    pub data: String,
}

// ── Db API (这些方法只是发消息到 writer thread) ────────────────────────────────

use crate::config::db::Db;
use crate::config::db::DbCmd;

pub(crate) struct UpsertTrafficLogParams<'a> {
    pub id: i64,
    pub method: &'a str,
    pub uri: &'a str,
    pub timestamp: i64,
    pub headers_json: &'a str,
    pub query_json: &'a str,
    pub body: Option<&'a str>,
}

impl Db {
    pub(crate) fn upsert_traffic_log(
        &self,
        p: UpsertTrafficLogParams<'_>,
    ) -> Result<(), sqlite::Error> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.send(DbCmd::UpsertTrafficLog {
            id: p.id,
            method: p.method.to_string(),
            uri: p.uri.to_string(),
            timestamp: p.timestamp,
            headers_json: p.headers_json.to_string(),
            query_json: p.query_json.to_string(),
            body: p.body.map(String::from),
            reply: Some(reply_tx),
        })?;
        reply_rx.recv().map_err(|_| sqlite::Error {
            code: None,
            message: Some("db writer thread disconnected".into()),
        })??;
        Ok(())
    }

    pub(crate) fn update_traffic_response(
        &self,
        id: i64,
        status: u16,
        timestamp: i64,
        duration_ms: u64,
        headers_json: &str,
    ) -> Result<(), sqlite::Error> {
        self.send(DbCmd::UpdateTrafficResponse {
            id,
            status,
            timestamp,
            duration_ms,
            headers_json: headers_json.to_string(),
        })
    }

    pub(crate) fn update_traffic_response_body(
        &self,
        id: i64,
        body: &str,
    ) -> Result<(), sqlite::Error> {
        self.send(DbCmd::UpdateTrafficResponseBody {
            id,
            body: body.to_string(),
        })
    }

    pub(crate) fn set_traffic_error(&self, id: i64, error: &str) -> Result<(), sqlite::Error> {
        self.send(DbCmd::SetTrafficError {
            id,
            error: error.to_string(),
        })
    }

    /// 标记响应流异常终止（`reason` = `error` / `aborted`）。
    pub(crate) fn set_traffic_terminated(
        &self,
        id: i64,
        reason: &str,
    ) -> Result<(), sqlite::Error> {
        self.send(DbCmd::SetTrafficTerminated {
            id,
            reason: reason.to_string(),
        })
    }

    pub(crate) fn insert_chunk(
        &self,
        request_id: i64,
        chunk: &str,
        seq: i64,
        created_at: i64,
    ) -> Result<(), sqlite::Error> {
        self.send(DbCmd::InsertChunk {
            request_id,
            chunk: chunk.to_string(),
            seq,
            created_at,
        })
    }

    pub(crate) fn load_all_traffic(&self) -> Result<Vec<TrafficLogEntry>, sqlite::Error> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.send(DbCmd::LoadAllTraffic { reply: reply_tx })?;
        reply_rx.recv().map_err(|_| sqlite::Error {
            code: None,
            message: Some("db writer thread disconnected".into()),
        })?
    }

    pub(crate) fn load_chunks(&self, request_id: i64) -> Result<Vec<ChunkRecord>, sqlite::Error> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.send(DbCmd::LoadChunks {
            request_id,
            reply: reply_tx,
        })?;
        reply_rx.recv().map_err(|_| sqlite::Error {
            code: None,
            message: Some("db writer thread disconnected".into()),
        })?
    }

    /// 按 id 加载单条流量详情（含 response_chunks）。
    pub(crate) fn load_traffic_detail(&self, id: i64) -> Result<TrafficLogEntry, sqlite::Error> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.send(DbCmd::LoadTrafficDetail {
            id,
            reply: reply_tx,
        })?;
        reply_rx.recv().map_err(|_| sqlite::Error {
            code: None,
            message: Some("db writer thread disconnected".into()),
        })?
    }

    #[allow(dead_code)]
    pub(crate) fn clear_traffic(&self) -> Result<(), sqlite::Error> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.send(DbCmd::ClearTraffic { reply: reply_tx })?;
        reply_rx.recv().map_err(|_| sqlite::Error {
            code: None,
            message: Some("db writer thread disconnected".into()),
        })?
    }

    /// 查询 traffic_logs 表当前最大 id，用于启动时初始化计数器。
    pub(crate) fn max_traffic_id(&self) -> Result<i64, sqlite::Error> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.send(DbCmd::MaxTrafficId { reply: reply_tx })?;
        reply_rx.recv().map_err(|_| sqlite::Error {
            code: None,
            message: Some("db writer thread disconnected".into()),
        })?
    }
}

// ── SQL operations (called from writer thread) ─────────────────────────────────

pub(crate) fn do_upsert_traffic_log(
    conn: &sqlite::Connection,
    p: UpsertTrafficLogParams<'_>,
) -> Result<(), sqlite::Error> {
    let mut stmt = conn.prepare(
        "INSERT INTO traffic_logs (id, method, uri, request_timestamp, request_headers, request_query, request_body) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )?;
    stmt.bind((1_usize, p.id))?;
    stmt.bind((2_usize, p.method))?;
    stmt.bind((3_usize, p.uri))?;
    stmt.bind((4_usize, p.timestamp))?;
    stmt.bind((5_usize, p.headers_json))?;
    stmt.bind((6_usize, p.query_json))?;
    match p.body {
        Some(b) => stmt.bind((7_usize, b))?,
        None => stmt.bind((7_usize, sqlite::Value::Null))?,
    }
    stmt.next()?;
    Ok(())
}

pub(crate) fn do_update_traffic_response(
    conn: &sqlite::Connection,
    id: i64,
    status: u16,
    timestamp: i64,
    duration_ms: u64,
    headers_json: &str,
) -> Result<(), sqlite::Error> {
    let mut stmt = conn.prepare(
        "UPDATE traffic_logs SET status = ?, response_timestamp = ?, duration_ms = ?, response_headers = ? WHERE id = ?",
    )?;
    stmt.bind((1_usize, status as i64))?;
    stmt.bind((2_usize, timestamp))?;
    stmt.bind((3_usize, duration_ms as i64))?;
    stmt.bind((4_usize, headers_json))?;
    stmt.bind((5_usize, id))?;
    stmt.next()?;
    Ok(())
}

pub(crate) fn do_update_traffic_response_body(
    conn: &sqlite::Connection,
    id: i64,
    body: &str,
) -> Result<(), sqlite::Error> {
    let mut stmt = conn.prepare("UPDATE traffic_logs SET response_body = ? WHERE id = ?")?;
    stmt.bind((1_usize, body))?;
    stmt.bind((2_usize, id))?;
    stmt.next()?;
    Ok(())
}

pub(crate) fn do_set_traffic_error(
    conn: &sqlite::Connection,
    id: i64,
    error: &str,
) -> Result<(), sqlite::Error> {
    let mut stmt = conn.prepare("UPDATE traffic_logs SET error = ? WHERE id = ?")?;
    stmt.bind((1_usize, error))?;
    stmt.bind((2_usize, id))?;
    stmt.next()?;
    Ok(())
}

pub(crate) fn do_set_traffic_terminated(
    conn: &sqlite::Connection,
    id: i64,
    reason: &str,
) -> Result<(), sqlite::Error> {
    let mut stmt = conn.prepare("UPDATE traffic_logs SET terminated = ? WHERE id = ?")?;
    stmt.bind((1_usize, reason))?;
    stmt.bind((2_usize, id))?;
    stmt.next()?;
    Ok(())
}

pub(crate) fn do_insert_chunk(
    conn: &sqlite::Connection,
    request_id: i64,
    chunk: &str,
    seq: i64,
    created_at: i64,
) -> Result<(), sqlite::Error> {
    let mut stmt = conn.prepare(
        "INSERT INTO response_chunks (request_id, chunk, seq, created_at) VALUES (?, ?, ?, ?)",
    )?;
    stmt.bind((1_usize, request_id))?;
    stmt.bind((2_usize, chunk))?;
    stmt.bind((3_usize, seq))?;
    stmt.bind((4_usize, created_at))?;
    stmt.next()?;
    Ok(())
}

/// 将 DB 中的 JSON 字符串解析为 HashMap。
/// 优先按纯 Map 解析（新格式 `{"k":"v"}`），失败则回退到 KV 数组（旧格式 `[{"key":"k","value":"v"}]`）。
pub(crate) fn parse_kv_json(s: &str) -> HashMap<String, String> {
    // 新格式：纯映射
    if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(s) {
        return map;
    }
    // 旧格式兼容：KV 数组
    if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(s) {
        let mut map = HashMap::new();
        for item in arr {
            if let (Some(k), Some(v)) = (
                item.get("key").and_then(|v| v.as_str()),
                item.get("value").and_then(|v| v.as_str()),
            ) {
                map.insert(k.to_string(), v.to_string());
            }
        }
        return map;
    }
    HashMap::new()
}

pub(crate) fn do_load_all_traffic(
    conn: &sqlite::Connection,
) -> Result<Vec<TrafficLogEntry>, sqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, method, uri, request_timestamp, request_headers, request_body, request_query, status, response_timestamp, duration_ms, response_headers, response_body, error, terminated FROM traffic_logs ORDER BY request_timestamp DESC",
    )?;
    let mut entries = Vec::new();
    while let sqlite::State::Row = stmt.next()? {
        let headers_str: String = stmt.read::<String, _>(4)?;
        let headers: HashMap<String, String> = parse_kv_json(&headers_str);
        let query_str: Option<String> = stmt.read::<Option<String>, _>(6)?;
        let query: Option<HashMap<String, String>> = query_str.map(|s| parse_kv_json(&s));
        let resp_headers_str: Option<String> = stmt.read::<Option<String>, _>(10)?;
        let resp_headers: Option<HashMap<String, String>> =
            resp_headers_str.map(|s| parse_kv_json(&s));

        entries.push(TrafficLogEntry {
            id: stmt.read::<i64, _>(0)? as u64,
            method: stmt.read::<String, _>(1)?,
            uri: stmt.read::<String, _>(2)?,
            request_timestamp: stmt.read::<i64, _>(3)?,
            request_headers: headers,
            request_body: stmt.read::<Option<String>, _>(5)?,
            request_query: query,
            status: stmt.read::<Option<i64>, _>(7)?.map(|v| v as u16),
            response_timestamp: stmt.read::<Option<i64>, _>(8)?,
            duration_ms: stmt.read::<Option<i64>, _>(9)?.map(|v| v as u64),
            response_headers: resp_headers,
            response_body: stmt.read::<Option<String>, _>(11)?,
            error: stmt.read::<Option<String>, _>(12)?,
            terminated: stmt.read::<Option<String>, _>(13)?,
            response_chunks: Vec::new(),
        });
    }
    Ok(entries)
}

pub(crate) fn do_load_chunks(
    conn: &sqlite::Connection,
    request_id: i64,
) -> Result<Vec<ChunkRecord>, sqlite::Error> {
    let mut stmt =
        conn.prepare("SELECT chunk FROM response_chunks WHERE request_id = ? ORDER BY seq")?;
    stmt.bind((1_usize, request_id))?;
    let mut chunks = Vec::new();
    while let sqlite::State::Row = stmt.next()? {
        chunks.push(ChunkRecord {
            data: stmt.read::<String, _>(0)?,
        });
    }
    Ok(chunks)
}

pub(crate) fn do_load_traffic_detail(
    conn: &sqlite::Connection,
    id: i64,
) -> Result<TrafficLogEntry, sqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, method, uri, request_timestamp, request_headers, request_body, request_query, status, response_timestamp, duration_ms, response_headers, response_body, error, terminated FROM traffic_logs WHERE id = ?",
    )?;
    stmt.bind((1_usize, id))?;
    if let sqlite::State::Row = stmt.next()? {
        let headers_str: String = stmt.read::<String, _>(4)?;
        let headers: HashMap<String, String> = parse_kv_json(&headers_str);
        let query_str: Option<String> = stmt.read::<Option<String>, _>(6)?;
        let query: Option<HashMap<String, String>> = query_str.map(|s| parse_kv_json(&s));
        let resp_headers_str: Option<String> = stmt.read::<Option<String>, _>(10)?;
        let resp_headers: Option<HashMap<String, String>> =
            resp_headers_str.and_then(|s| serde_json::from_str(&s).ok());

        Ok(TrafficLogEntry {
            id: stmt.read::<i64, _>(0)? as u64,
            method: stmt.read::<String, _>(1)?,
            uri: stmt.read::<String, _>(2)?,
            request_timestamp: stmt.read::<i64, _>(3)?,
            request_headers: headers,
            request_body: stmt.read::<Option<String>, _>(5)?,
            request_query: query,
            status: stmt.read::<Option<i64>, _>(7)?.map(|v| v as u16),
            response_timestamp: stmt.read::<Option<i64>, _>(8)?,
            duration_ms: stmt.read::<Option<i64>, _>(9)?.map(|v| v as u64),
            response_headers: resp_headers,
            response_body: stmt.read::<Option<String>, _>(11)?,
            error: stmt.read::<Option<String>, _>(12)?,
            terminated: stmt.read::<Option<String>, _>(13)?,
            response_chunks: Vec::new(),
        })
    } else {
        Err(sqlite::Error {
            code: None,
            message: Some(format!("traffic log id={id} not found")),
        })
    }
}

// ── Migration ─────────────────────────────────────────────────────────────────

impl DbTable for TrafficTable {
    fn migrate(conn: &sqlite::Connection) -> Result<(), sqlite::Error> {
        conn.execute(
            "CREATE TABLE IF NOT EXISTS traffic_logs (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                method            TEXT NOT NULL,
                uri               TEXT NOT NULL,
                request_timestamp INTEGER NOT NULL,
                request_headers   TEXT NOT NULL DEFAULT '{}',
                request_body      TEXT,
                request_query     TEXT DEFAULT '{}',
                status            INTEGER,
                response_timestamp INTEGER,
                duration_ms       INTEGER,
                response_headers  TEXT,
                response_body     TEXT,
                error             TEXT,
                terminated        TEXT
            )",
        )?;

        // 旧库迁移：terminated 列（响应流异常终止标记）在此列引入前建的库里不存在
        add_column_if_missing(conn, "traffic_logs", "terminated", "TEXT")?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS response_chunks (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                request_id  INTEGER NOT NULL,
                chunk       TEXT NOT NULL,
                seq         INTEGER NOT NULL,
                created_at  INTEGER NOT NULL DEFAULT 0
            )",
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_response_chunks_request_id ON response_chunks(request_id)",
        )?;

        Ok(())
    }
}
