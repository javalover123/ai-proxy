use serde::{Deserialize, Serialize};

pub(crate) mod ai;
pub(crate) mod collection_nodes;
pub(crate) mod collection_requests;
pub(crate) mod id;
pub(crate) mod traffic;

// ── DbTable trait ────────────────────────────────────────────────────────────────

/// Each storage module implements this trait to handle its own table creation.
pub(crate) trait DbTable {
    fn migrate(conn: &sqlite::Connection) -> Result<(), sqlite::Error>;
}

/// 旧库迁移助手：列不存在时才 `ALTER TABLE ... ADD COLUMN`。
///
/// `CREATE TABLE IF NOT EXISTS` 对已存在的表是 no-op，所以给现有表加列必须走这里，
/// 否则老库永远拿不到新列。
pub(crate) fn add_column_if_missing(
    conn: &sqlite::Connection,
    table: &str,
    column: &str,
    decl: &str,
) -> Result<(), sqlite::Error> {
    let exists = {
        let mut stmt = conn.prepare("SELECT 1 FROM pragma_table_info(?) WHERE name = ?")?;
        stmt.bind((1_usize, table))?;
        stmt.bind((2_usize, column))?;
        matches!(stmt.next()?, sqlite::State::Row)
    };
    if !exists {
        conn.execute(format!("ALTER TABLE {table} ADD COLUMN {column} {decl}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn columns(conn: &sqlite::Connection, table: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare("SELECT name FROM pragma_table_info(?)")
            .expect("prepare");
        stmt.bind((1_usize, table)).expect("bind");
        let mut names = Vec::new();
        while let sqlite::State::Row = stmt.next().expect("step") {
            names.push(stmt.read::<String, _>(0).expect("read"));
        }
        names
    }

    /// 旧库（缺列）→ 补列；再跑一次幂等，不会因重复 ALTER 失败。
    #[test]
    fn adds_missing_column_once() {
        let conn = sqlite::open(":memory:").expect("open");
        conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)")
            .expect("create");

        add_column_if_missing(&conn, "t", "terminated", "TEXT").expect("first migrate");
        assert_eq!(columns(&conn, "t"), vec!["id", "terminated"]);

        add_column_if_missing(&conn, "t", "terminated", "TEXT").expect("second migrate");
        assert_eq!(columns(&conn, "t"), vec!["id", "terminated"]);
    }

    /// 新库（建表时已含该列）→ 不重复 ALTER。
    #[test]
    fn leaves_existing_column_untouched() {
        let conn = sqlite::open(":memory:").expect("open");
        conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, terminated TEXT)")
            .expect("create");

        add_column_if_missing(&conn, "t", "terminated", "TEXT").expect("migrate");

        assert_eq!(columns(&conn, "t"), vec!["id", "terminated"]);
    }
}

/// A key-value pair representing an HTTP header.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct HeaderPair {
    pub key: String,
    pub value: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

/// A collection of API requests organized in a tree structure.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ApiCollection {
    pub id: i64,
    pub name: String,
    pub children: Vec<ApiTreeNode>,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
}

/// A node in the API collection tree — either a folder or a request.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ApiTreeNode {
    #[serde(rename = "folder")]
    Folder {
        id: i64,
        name: String,
        children: Vec<ApiTreeNode>,
    },
    #[serde(rename = "request")]
    Request {
        id: i64,
        name: String,
        method: String,
        url: String,
        headers: Vec<HeaderPair>,
        params: Vec<HeaderPair>,
        cookies: Vec<HeaderPair>,
        #[serde(rename = "bodyType")]
        body_type: String,
        body: String,
        #[serde(rename = "authType")]
        auth_type: Option<String>,
        #[serde(rename = "authData")]
        auth_data: Option<String>,
        /// The request_id linking to the `collection_requests` table.
        #[serde(rename = "requestId")]
        request_id: i64,
    },
}
