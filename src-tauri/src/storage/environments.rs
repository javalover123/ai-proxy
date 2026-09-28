use std::sync::mpsc;

use serde::{Deserialize, Serialize};

use crate::storage::DbTable;

// ── Row / IPC types ────────────────────────────────────────────────────────────

fn default_true() -> bool {
    true
}

/// A single environment / global variable (key-value pair).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EnvVariable {
    pub key: String,
    pub value: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

/// An environment with its own variables.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Environment {
    pub id: i64,
    pub name: String,
    pub variables: Vec<EnvVariable>,
    /// 是否为内置默认环境（正式/测试），不可删除。
    #[serde(default)]
    pub protected: bool,
}

/// Full environment store snapshot returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EnvStoreSnapshot {
    pub environments: Vec<Environment>,
    pub global_variables: Vec<EnvVariable>,
    pub active_env_id: Option<i64>,
}

// ── Table marker ───────────────────────────────────────────────────────────────

pub(crate) struct EnvironmentsTable;

// ── Repository trait ───────────────────────────────────────────────────────────

pub(crate) trait EnvironmentsRepository {
    fn load_env_store(&self) -> Result<EnvStoreSnapshot, sqlite::Error>;

    /// 一次提交整个环境快照（新增/改名/删除/变量），返回落库后的规范快照。
    fn save_env_store(&self, store: &EnvStoreSnapshot) -> Result<EnvStoreSnapshot, sqlite::Error>;
}

// ── Db API ─────────────────────────────────────────────────────────────────────

use crate::config::db::{Db, DbCmd};

impl EnvironmentsRepository for Db {
    fn load_env_store(&self) -> Result<EnvStoreSnapshot, sqlite::Error> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.send(DbCmd::LoadEnvStore { reply: reply_tx })?;
        reply_rx.recv().map_err(|_| sqlite::Error {
            code: None,
            message: Some("db writer thread disconnected".into()),
        })?
    }

    fn save_env_store(&self, store: &EnvStoreSnapshot) -> Result<EnvStoreSnapshot, sqlite::Error> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.send(DbCmd::SaveEnvStore {
            store: store.clone(),
            reply: reply_tx,
        })?;
        reply_rx.recv().map_err(|_| sqlite::Error {
            code: None,
            message: Some("db writer thread disconnected".into()),
        })?
    }
}

// ── SQL operations (called from writer thread) ─────────────────────────────────

fn read_env_variables(
    conn: &sqlite::Connection,
    scope: &str,
    env_id: Option<i64>,
) -> Result<Vec<EnvVariable>, sqlite::Error> {
    let sql = if env_id.is_some() {
        "SELECT key, value, enabled FROM env_variables WHERE scope = ? AND env_id = ? ORDER BY id"
    } else {
        "SELECT key, value, enabled FROM env_variables WHERE scope = ? ORDER BY id"
    };
    let mut stmt = conn.prepare(sql)?;
    stmt.bind((1_usize, scope))?;
    if let Some(id) = env_id {
        stmt.bind((2_usize, id))?;
    }
    let mut vars = Vec::new();
    while let sqlite::State::Row = stmt.next()? {
        vars.push(EnvVariable {
            key: stmt.read::<String, _>(0)?,
            value: stmt.read::<String, _>(1)?,
            enabled: stmt.read::<i64, _>(2)? != 0,
        });
    }
    Ok(vars)
}

pub(crate) fn do_load_env_store(
    conn: &sqlite::Connection,
) -> Result<EnvStoreSnapshot, sqlite::Error> {
    let mut environments = Vec::new();
    {
        let mut stmt = conn.prepare("SELECT id, name, protected FROM environments ORDER BY id")?;
        while let sqlite::State::Row = stmt.next()? {
            let id = stmt.read::<i64, _>(0)?;
            let name = stmt.read::<String, _>(1)?;
            let protected = stmt.read::<i64, _>(2)? != 0;
            let variables = read_env_variables(conn, "env", Some(id))?;
            environments.push(Environment {
                id,
                name,
                variables,
                protected,
            });
        }
    }

    let global_variables = read_env_variables(conn, "global", None)?;

    // 激活环境不持久化，加载时默认指向第一个环境
    let active_env_id = environments.first().map(|e| e.id);

    Ok(EnvStoreSnapshot {
        environments,
        global_variables,
        active_env_id,
    })
}

pub(crate) fn do_create_environment(
    conn: &sqlite::Connection,
    name: &str,
    timestamp: i64,
    protected: bool,
) -> Result<i64, sqlite::Error> {
    let mut stmt = conn.prepare(
        "INSERT INTO environments (name, protected, created_at, updated_at) VALUES (?, ?, ?, ?)",
    )?;
    stmt.bind((1_usize, name))?;
    stmt.bind((2_usize, i64::from(protected)))?;
    stmt.bind((3_usize, timestamp))?;
    stmt.bind((4_usize, timestamp))?;
    stmt.next()?;
    let mut id_stmt = conn.prepare("SELECT last_insert_rowid()")?;
    id_stmt.next()?;
    id_stmt.read::<i64, _>(0)
}

pub(crate) fn do_rename_environment(
    conn: &sqlite::Connection,
    id: i64,
    name: &str,
    timestamp: i64,
) -> Result<(), sqlite::Error> {
    // 内置默认环境（正式/测试）不允许改名
    let protected = {
        let mut stmt = conn.prepare("SELECT protected FROM environments WHERE id = ?")?;
        stmt.bind((1_usize, id))?;
        if let sqlite::State::Row = stmt.next()? {
            stmt.read::<i64, _>(0)? != 0
        } else {
            return Ok(()); // 已不存在，视为成功
        }
    };
    if protected {
        return Err(sqlite::Error {
            code: None,
            message: Some("default environment cannot be renamed".into()),
        });
    }

    let mut stmt = conn.prepare("UPDATE environments SET name = ?, updated_at = ? WHERE id = ?")?;
    stmt.bind((1_usize, name))?;
    stmt.bind((2_usize, timestamp))?;
    stmt.bind((3_usize, id))?;
    stmt.next()?;
    Ok(())
}

pub(crate) fn do_delete_environment(
    conn: &sqlite::Connection,
    id: i64,
) -> Result<(), sqlite::Error> {
    // 内置默认环境（正式/测试）不允许删除
    let protected = {
        let mut stmt = conn.prepare("SELECT protected FROM environments WHERE id = ?")?;
        stmt.bind((1_usize, id))?;
        if let sqlite::State::Row = stmt.next()? {
            stmt.read::<i64, _>(0)? != 0
        } else {
            return Ok(()); // 已不存在，视为成功
        }
    };
    if protected {
        return Err(sqlite::Error {
            code: None,
            message: Some("default environment cannot be deleted".into()),
        });
    }

    let mut stmt = conn.prepare("DELETE FROM env_variables WHERE scope = 'env' AND env_id = ?")?;
    stmt.bind((1_usize, id))?;
    stmt.next()?;

    let mut stmt = conn.prepare("DELETE FROM environments WHERE id = ?")?;
    stmt.bind((1_usize, id))?;
    stmt.next()?;
    Ok(())
}

fn do_replace_variables(
    conn: &sqlite::Connection,
    scope: &str,
    env_id: Option<i64>,
    vars: &[EnvVariable],
) -> Result<(), sqlite::Error> {
    // Delete existing rows for this scope
    if let Some(id) = env_id {
        let mut stmt = conn.prepare("DELETE FROM env_variables WHERE scope = ? AND env_id = ?")?;
        stmt.bind((1_usize, scope))?;
        stmt.bind((2_usize, id))?;
        stmt.next()?;
    } else {
        let mut stmt = conn.prepare("DELETE FROM env_variables WHERE scope = ?")?;
        stmt.bind((1_usize, scope))?;
        stmt.next()?;
    }

    // Re-insert
    let mut stmt = conn.prepare(
        "INSERT INTO env_variables (scope, env_id, key, value, enabled) VALUES (?, ?, ?, ?, ?)",
    )?;
    for v in vars {
        stmt.bind((1_usize, scope))?;
        match env_id {
            Some(id) => stmt.bind((2_usize, id))?,
            None => stmt.bind((2_usize, sqlite::Value::Null))?,
        }
        stmt.bind((3_usize, v.key.as_str()))?;
        stmt.bind((4_usize, v.value.as_str()))?;
        stmt.bind((5_usize, i64::from(v.enabled)))?;
        stmt.next()?;
        // 复用同一 statement：next() 返回 Done 后需 reset 才能再次 bind。
        stmt.reset()?;
    }
    Ok(())
}

pub(crate) fn do_save_environment_variables(
    conn: &sqlite::Connection,
    env_id: i64,
    vars: &[EnvVariable],
) -> Result<(), sqlite::Error> {
    do_replace_variables(conn, "env", Some(env_id), vars)
}

pub(crate) fn do_save_global_variables(
    conn: &sqlite::Connection,
    vars: &[EnvVariable],
) -> Result<(), sqlite::Error> {
    do_replace_variables(conn, "global", None, vars)
}

/// 把整份环境快照一次性落库：id > 0 视为已存在（改名 + 覆盖变量），
/// id <= 0 视为新建；快照中缺失的旧环境被删除；内置环境（protected）跳过改名/删除。
pub(crate) fn do_save_env_store(
    conn: &sqlite::Connection,
    store: &EnvStoreSnapshot,
) -> Result<EnvStoreSnapshot, sqlite::Error> {
    let current = do_load_env_store(conn)?;
    let ts = crate::utils::date::now_ms();

    for env in &store.environments {
        if env.id > 0 {
            if let Some(cur) = current.environments.iter().find(|c| c.id == env.id)
                && !cur.protected
                && cur.name != env.name
            {
                do_rename_environment(conn, env.id, &env.name, ts)?;
            }
            do_save_environment_variables(conn, env.id, &env.variables)?;
        } else {
            let id = do_create_environment(conn, &env.name, ts, env.protected)?;
            do_save_environment_variables(conn, id, &env.variables)?;
        }
    }

    for cur in &current.environments {
        let still_exists = store.environments.iter().any(|e| e.id == cur.id);
        if !still_exists && !cur.protected {
            do_delete_environment(conn, cur.id)?;
        }
    }

    do_save_global_variables(conn, &store.global_variables)?;

    do_load_env_store(conn)
}

// ── Migration ─────────────────────────────────────────────────────────────────

impl DbTable for EnvironmentsTable {
    fn migrate(conn: &sqlite::Connection) -> Result<(), sqlite::Error> {
        // 已废弃的 app_meta 表（曾存 active_env_id，现不再持久化）——清理旧库
        conn.execute("DROP TABLE IF EXISTS app_meta")?;
        conn.execute(
            "CREATE TABLE IF NOT EXISTS environments (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT NOT NULL DEFAULT '',
                protected  INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
        )?;
        // 旧库（本分支早期已建表、无 protected 列）补列
        crate::storage::add_column_if_missing(
            conn,
            "environments",
            "protected",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        conn.execute(
            "CREATE TABLE IF NOT EXISTS env_variables (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                scope   TEXT NOT NULL,
                env_id  INTEGER,
                key     TEXT NOT NULL DEFAULT '',
                value   TEXT NOT NULL DEFAULT '',
                enabled INTEGER NOT NULL DEFAULT 1
            )",
        )?;
        Ok(())
    }
}
