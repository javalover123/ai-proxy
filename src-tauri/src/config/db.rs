use std::path::PathBuf;
use std::sync::Arc;
use std::sync::mpsc;

use crate::proxy::ai::AiTimelineTurnDto;
use crate::storage::DbTable;
use crate::storage::ai;
use crate::storage::ai::AiTable;
use crate::storage::collection_nodes;
use crate::storage::collection_nodes::CollectionNodesTable;
use crate::storage::collection_requests;
use crate::storage::collection_requests::CollectionRequestsTable;
use crate::storage::traffic;
use crate::storage::traffic::TrafficTable;

// ── Writer thread command ──────────────────────────────────────────────────────

type SyncSender = mpsc::SyncSender<DbCmd>;

pub(crate) enum DbCmd {
    // ── Traffic logging ────────────────────────────────────────────────────
    UpsertTrafficLog {
        id: i64,
        method: String,
        uri: String,
        timestamp: i64,
        headers_json: String,
        query_json: String,
        body: Option<String>,
        reply: Option<mpsc::Sender<Result<(), sqlite::Error>>>,
    },
    UpdateTrafficResponse {
        id: i64,
        status: u16,
        timestamp: i64,
        duration_ms: u64,
        headers_json: String,
    },
    UpdateTrafficResponseBody {
        id: i64,
        body: String,
    },
    SetTrafficError {
        id: i64,
        error: String,
    },
    /// 标记响应流异常终止（`error` = 上游流出错，`aborted` = 下游未读完）。
    SetTrafficTerminated {
        id: i64,
        reason: String,
    },
    InsertChunk {
        request_id: i64,
        chunk: String,
        seq: i64,
        created_at: i64,
    },
    LoadAllTraffic {
        reply: mpsc::Sender<Result<Vec<traffic::TrafficLogEntry>, sqlite::Error>>,
    },
    LoadChunks {
        request_id: i64,
        reply: mpsc::Sender<Result<Vec<traffic::ChunkRecord>, sqlite::Error>>,
    },
    LoadTrafficDetail {
        id: i64,
        reply: mpsc::Sender<Result<traffic::TrafficLogEntry, sqlite::Error>>,
    },
    ClearTraffic {
        reply: mpsc::Sender<Result<(), sqlite::Error>>,
    },
    /// Query the maximum traffic_logs id for counter initialization.
    MaxTrafficId {
        reply: mpsc::Sender<Result<i64, sqlite::Error>>,
    },

    // ── Collection management ───────────────────────────────────────────────
    LoadAllCollectionNodes {
        reply: mpsc::Sender<Result<Vec<collection_nodes::CollectionNodeRow>, sqlite::Error>>,
    },
    InsertCollectionRequest {
        name: String,
        method: String,
        uri: String,
        timestamp: i64,
        reply: mpsc::Sender<Result<i64, sqlite::Error>>,
    },
    UpdateCollectionRequest {
        id: i64,
        method: String,
        uri: String,
        headers: String,
        query: String,
        body: Option<String>,
        body_type: String,
        cookies: String,
        auth_type: String,
        auth_data: String,
        timestamp: i64,
    },
    DuplicateCollectionRequest {
        id: i64,
        timestamp: i64,
        reply: mpsc::Sender<Result<i64, sqlite::Error>>,
    },
    FindCollectionRequestsByIds {
        ids: Vec<i64>,
        reply: mpsc::Sender<Result<Vec<collection_requests::CollectionRequestRow>, sqlite::Error>>,
    },
    CreateCollection {
        name: String,
        timestamp: i64,
        reply: mpsc::Sender<Result<i64, sqlite::Error>>,
    },
    CreateFolder {
        parent_id: i64,
        name: String,
        timestamp: i64,
        reply: mpsc::Sender<Result<i64, sqlite::Error>>,
    },
    CreateRequestNode {
        parent_id: i64,
        name: String,
        request_id: i64,
        timestamp: i64,
        reply: mpsc::Sender<Result<i64, sqlite::Error>>,
    },
    RenameNode {
        id: i64,
        new_name: String,
        timestamp: i64,
    },
    MoveNode {
        id: i64,
        new_parent_id: i64,
        timestamp: i64,
    },
    DeleteNodeIfNotLast {
        node_id: i64,
        reply: mpsc::Sender<Result<(), sqlite::Error>>,
    },

    // ── AI persistence ─────────────────────────────────────────────────────
    UpsertAiSession(ai::UpsertAiSessionParams),
    InsertAiRequest {
        id: i64,
        session_id: String,
        start_ms: i64,
        created_at: i64,
    },
    InsertAiTurns {
        turns: Vec<ai::AiTurnInsert>,
    },
    UpdateAiRequestFinal(ai::AiRequestFinalParams),
    UpdateAiSessionFinal(ai::AiSessionFinalParams),
    LoadAiStore {
        reply: mpsc::Sender<Result<ai::AiStoreSnapshot, sqlite::Error>>,
    },
    ListAiSessions {
        reply: mpsc::Sender<Result<Vec<ai::AiSessionSummary>, sqlite::Error>>,
    },
    GetAiSession {
        session_id: String,
        reply: mpsc::Sender<Result<Vec<AiTimelineTurnDto>, sqlite::Error>>,
    },
    GetAiThinking {
        session_id: String,
        request_id: i64,
        fingerprint: i64,
        reply: mpsc::Sender<Result<Vec<String>, sqlite::Error>>,
    },

    /// Graceful shutdown — writer thread exits after processing pending commands.
    Shutdown,
}

// ── Db shell ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub(crate) struct Db {
    tx: Option<Arc<SyncSender>>,
}

impl Db {
    pub(crate) fn open(path: &PathBuf) -> Result<Self, sqlite::Error> {
        let db_path = path.to_string_lossy().to_string();
        let conn = sqlite::open(path)?;
        migrate(&conn)?;

        let (cmd_tx, cmd_rx) = mpsc::sync_channel::<DbCmd>(256);
        let tx = Arc::new(cmd_tx);
        std::thread::Builder::new()
            .name("db-writer".into())
            .spawn(move || writer_loop(conn, cmd_rx, db_path))
            .expect("failed to spawn db-writer thread");

        Ok(Self { tx: Some(tx) })
    }

    pub(crate) fn shutdown(&self) {
        if let Some(ref tx) = self.tx {
            tx.send(DbCmd::Shutdown).ok();
        }
    }

    /// Send a command, failing if the writer thread is gone.
    pub(crate) fn send(&self, cmd: DbCmd) -> Result<(), sqlite::Error> {
        match self.tx {
            Some(ref tx) => tx.send(cmd).map_err(|_| sqlite::Error {
                code: None,
                message: Some("db writer thread disconnected".into()),
            }),
            None => Ok(()),
        }
    }
}

// ── Migration ─────────────────────────────────────────────────────────────────

fn migrate(conn: &sqlite::Connection) -> Result<(), sqlite::Error> {
    conn.execute("PRAGMA journal_mode=WAL")?;

    // Drop old tables (clean break from unified `requests` era)
    conn.execute("DROP TABLE IF EXISTS response_chunks")?;
    conn.execute("DROP TABLE IF EXISTS requests")?;

    // Each module handles its own table creation
    AiTable::migrate(conn)?;
    CollectionNodesTable::migrate(conn)?;
    CollectionRequestsTable::migrate(conn)?;
    TrafficTable::migrate(conn)?;

    Ok(())
}

// ── Writer thread ─────────────────────────────────────────────────────────────

fn writer_loop(conn: sqlite::Connection, rx: mpsc::Receiver<DbCmd>, db_path: String) {
    while let Ok(cmd) = rx.recv() {
        match cmd {
            DbCmd::Shutdown => break,

            // ── Traffic logging ────────────────────────────────────────────
            DbCmd::UpsertTrafficLog {
                id,
                method,
                uri,
                timestamp,
                headers_json,
                query_json,
                body,
                reply,
            } => {
                let result = traffic::do_upsert_traffic_log(
                    &conn,
                    traffic::UpsertTrafficLogParams {
                        id,
                        method: &method,
                        uri: &uri,
                        timestamp,
                        headers_json: &headers_json,
                        query_json: &query_json,
                        body: body.as_deref(),
                    },
                );
                if let Some(reply) = reply {
                    reply.send(result).ok();
                }
            }

            DbCmd::UpdateTrafficResponse {
                id,
                status,
                timestamp,
                duration_ms,
                headers_json,
            } => {
                traffic::do_update_traffic_response(
                    &conn,
                    id,
                    status,
                    timestamp,
                    duration_ms,
                    &headers_json,
                )
                .unwrap_or_else(|e| log::warn!("update_traffic_response: {e}"));
            }

            DbCmd::UpdateTrafficResponseBody { id, body } => {
                traffic::do_update_traffic_response_body(&conn, id, &body)
                    .unwrap_or_else(|e| log::warn!("update_traffic_response_body: {e}"));
            }

            DbCmd::SetTrafficError { id, error } => {
                traffic::do_set_traffic_error(&conn, id, &error)
                    .unwrap_or_else(|e| log::warn!("set_traffic_error: {e}"));
            }

            DbCmd::SetTrafficTerminated { id, reason } => {
                traffic::do_set_traffic_terminated(&conn, id, &reason)
                    .unwrap_or_else(|e| log::warn!("set_traffic_terminated: {e}"));
            }

            DbCmd::InsertChunk {
                request_id,
                chunk,
                seq,
                created_at,
            } => {
                traffic::do_insert_chunk(&conn, request_id, &chunk, seq, created_at)
                    .unwrap_or_else(|e| log::warn!("insert_chunk: {e}"));
            }

            DbCmd::LoadAllTraffic { reply } => {
                reply.send(traffic::do_load_all_traffic(&conn)).ok();
            }

            DbCmd::LoadChunks { request_id, reply } => {
                reply.send(traffic::do_load_chunks(&conn, request_id)).ok();
            }

            DbCmd::LoadTrafficDetail { id, reply } => {
                reply.send(traffic::do_load_traffic_detail(&conn, id)).ok();
            }

            DbCmd::ClearTraffic { reply } => {
                let result = (|| {
                    conn.execute("DELETE FROM response_chunks")?;
                    conn.execute("DELETE FROM traffic_logs")?;
                    Ok(())
                })();
                reply.send(result).ok();
            }

            DbCmd::MaxTrafficId { reply } => {
                let result = (|| {
                    let mut stmt = conn.prepare("SELECT COALESCE(MAX(id), 0) FROM traffic_logs")?;
                    stmt.next()?;
                    stmt.read::<i64, _>(0)
                })();
                reply.send(result).ok();
            }

            // ── Collection management ───────────────────────────────────────
            DbCmd::LoadAllCollectionNodes { reply } => {
                reply
                    .send(collection_nodes::do_load_all_collection_nodes(&conn))
                    .ok();
            }

            DbCmd::InsertCollectionRequest {
                name,
                method,
                uri,
                timestamp,
                reply,
            } => {
                reply
                    .send(collection_requests::do_insert_collection_request(
                        &conn, &name, &method, &uri, timestamp,
                    ))
                    .ok();
            }

            DbCmd::UpdateCollectionRequest {
                id,
                method,
                uri,
                headers,
                query,
                body,
                body_type,
                cookies,
                auth_type,
                auth_data,
                timestamp,
            } => {
                collection_requests::do_update_collection_request(
                    &conn,
                    collection_requests::UpdateCollectionRequestParams {
                        id,
                        method: &method,
                        uri: &uri,
                        headers: &headers,
                        query: &query,
                        body: body.as_deref(),
                        body_type: &body_type,
                        cookies: &cookies,
                        auth_type: &auth_type,
                        auth_data: &auth_data,
                        timestamp,
                    },
                )
                .unwrap_or_else(|e| log::warn!("update_collection_request: {e}"));
            }

            DbCmd::DuplicateCollectionRequest {
                id,
                timestamp,
                reply,
            } => {
                reply
                    .send(collection_requests::do_duplicate_collection_request(
                        &conn, id, timestamp,
                    ))
                    .ok();
            }

            DbCmd::FindCollectionRequestsByIds { ids, reply } => {
                reply
                    .send(collection_requests::do_find_collection_requests_by_ids(
                        &conn, &ids,
                    ))
                    .ok();
            }

            DbCmd::CreateCollection {
                name,
                timestamp,
                reply,
            } => {
                reply
                    .send(collection_nodes::do_create_collection(
                        &conn, &name, timestamp,
                    ))
                    .ok();
            }

            DbCmd::CreateFolder {
                parent_id,
                name,
                timestamp,
                reply,
            } => {
                reply
                    .send(collection_nodes::do_create_folder(
                        &conn, parent_id, &name, timestamp,
                    ))
                    .ok();
            }

            DbCmd::CreateRequestNode {
                parent_id,
                name,
                request_id,
                timestamp,
                reply,
            } => {
                reply
                    .send(collection_nodes::do_create_request_node(
                        &conn, parent_id, &name, request_id, timestamp,
                    ))
                    .ok();
            }

            DbCmd::RenameNode {
                id,
                new_name,
                timestamp,
            } => {
                collection_nodes::do_rename_node(&conn, id, &new_name, timestamp)
                    .unwrap_or_else(|e| log::warn!("rename_node: {e}"));
            }

            DbCmd::MoveNode {
                id,
                new_parent_id,
                timestamp,
            } => {
                collection_nodes::do_move_node(&conn, id, new_parent_id, timestamp)
                    .unwrap_or_else(|e| log::warn!("move_node: {e}"));
            }

            DbCmd::DeleteNodeIfNotLast { node_id, reply } => {
                reply
                    .send(collection_nodes::do_delete_node_if_not_last(&conn, node_id))
                    .ok();
            }

            // ── AI persistence ─────────────────────────────────────────────
            DbCmd::UpsertAiSession(p) => {
                ai::do_upsert_ai_session(&conn, &p)
                    .unwrap_or_else(|e| log::warn!("upsert_ai_session: {e}"));
            }

            DbCmd::InsertAiRequest {
                id,
                session_id,
                start_ms,
                created_at,
            } => {
                ai::do_insert_ai_request(&conn, id, &session_id, start_ms, created_at)
                    .unwrap_or_else(|e| log::warn!("insert_ai_request: {e}"));
            }

            DbCmd::InsertAiTurns { turns } => {
                ai::do_insert_ai_turns(&conn, &turns)
                    .unwrap_or_else(|e| log::warn!("insert_ai_turns: {e}"));
            }

            DbCmd::UpdateAiRequestFinal(p) => {
                ai::do_update_ai_request_final(&conn, &p)
                    .unwrap_or_else(|e| log::warn!("update_ai_request_final: {e}"));
            }

            DbCmd::UpdateAiSessionFinal(p) => {
                ai::do_update_ai_session_final(&conn, &p)
                    .unwrap_or_else(|e| log::warn!("update_ai_session_final: {e}"));
            }

            DbCmd::LoadAiStore { reply } => {
                reply.send(ai::do_load_ai_store(&conn)).ok();
            }

            DbCmd::ListAiSessions { reply } => {
                reply.send(ai::do_list_ai_sessions(&conn)).ok();
            }

            DbCmd::GetAiSession { session_id, reply } => {
                reply.send(ai::do_get_ai_session(&conn, &session_id)).ok();
            }

            DbCmd::GetAiThinking {
                session_id,
                request_id,
                fingerprint,
                reply,
            } => {
                reply
                    .send(ai::do_get_ai_thinking(
                        &conn,
                        &session_id,
                        request_id,
                        fingerprint,
                    ))
                    .ok();
            }
        }
    }
    log::info!("db writer thread exiting (path={db_path})");
}
