use serde::{Deserialize, Serialize};

pub(crate) mod collection_nodes;
pub(crate) mod collection_requests;
pub(crate) mod id;
pub(crate) mod traffic;

// ── DbTable trait ────────────────────────────────────────────────────────────────

/// Each storage module implements this trait to handle its own table creation.
pub(crate) trait DbTable {
    fn migrate(conn: &sqlite::Connection) -> Result<(), sqlite::Error>;
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
