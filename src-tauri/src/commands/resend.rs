use bytes::Bytes;
use rama::http::{Body, Method, Request};
use rama::net::uri::Uri;
use rama::service::Service;
use std::collections::HashMap;

use crate::AppState;
use crate::proxy::client;
use crate::proxy::ctx::ProxyCtx;
use crate::proxy::events::ProxyEvent;
use crate::proxy::record;

// ── Tagged union：前端 RequestBody ──────────────────────────────────────────

#[derive(serde::Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub(crate) enum RequestBody {
    Raw {
        content: String,
        /// `json` `xml` `urlencoded` `text` 或省略
        language: Option<String>,
    },
    FormData {
        parts: Vec<FormDataPart>,
    },
}

#[derive(serde::Deserialize)]
pub(crate) struct FormDataPart {
    key: String,
    value: String,
    #[serde(rename = "partType")]
    part_type: String,
}

// ── Content-Type helper ─────────────────────────────────────────────────────

/// 仅在 headers 中不存在大小写不敏感的 Content-Type 时才注入
fn inject_content_type_if_absent(headers: &mut HashMap<String, String>, ct: &str) {
    let has = headers.keys().any(|k| k.to_lowercase() == "content-type");
    if !has {
        headers.insert("Content-Type".to_string(), ct.to_string());
    }
}

// ── multipart/form-data builder ─────────────────────────────────────────────

fn build_multipart_body(
    parts: &[FormDataPart],
    headers: &mut HashMap<String, String>,
) -> Result<Bytes, String> {
    let boundary = uuid::Uuid::new_v4().to_string();
    let mut buf = Vec::new();

    for part in parts {
        if part.key.trim().is_empty() {
            continue;
        }
        let is_file = part.part_type == "file";

        buf.extend_from_slice(b"--");
        buf.extend_from_slice(boundary.as_bytes());
        buf.extend_from_slice(b"\r\n");

        if is_file {
            let path = part.value.trim();
            if path.is_empty() {
                continue;
            }
            let file_bytes =
                std::fs::read(path).map_err(|e| format!("cannot read file \"{path}\": {e}"))?;
            let filename = std::path::Path::new(path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "file".to_string());

            buf.extend_from_slice(
                format!(
                    "Content-Disposition: form-data; name=\"{}\"; filename=\"{}\"\r\n",
                    part.key, filename,
                )
                .as_bytes(),
            );
            buf.extend_from_slice(b"Content-Type: application/octet-stream\r\n\r\n");
            buf.extend_from_slice(&file_bytes);
            buf.extend_from_slice(b"\r\n");
        } else {
            buf.extend_from_slice(
                format!("Content-Disposition: form-data; name=\"{}\"\r\n", part.key).as_bytes(),
            );
            buf.extend_from_slice(b"\r\n");
            buf.extend_from_slice(part.value.as_bytes());
            buf.extend_from_slice(b"\r\n");
        }
    }

    // closing boundary
    buf.extend_from_slice(b"--");
    buf.extend_from_slice(boundary.as_bytes());
    buf.extend_from_slice(b"--\r\n");

    inject_content_type_if_absent(
        headers,
        &format!("multipart/form-data; boundary={boundary}"),
    );

    Ok(Bytes::from(buf))
}

// ── command ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn resend_request(
    state: tauri::State<'_, AppState>,
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<RequestBody>,
) -> Result<u64, String> {
    let method = Method::from_bytes(method.as_bytes()).unwrap_or(Method::GET);
    let full_uri: Uri = url.parse().map_err(|_| "invalid url")?;

    let mut header_map = headers;

    // Build body bytes from tagged union
    let body_bytes: Bytes = match body {
        Some(RequestBody::Raw { content, language }) => {
            match language.as_deref() {
                Some("json") => inject_content_type_if_absent(&mut header_map, "application/json"),
                Some("xml") => inject_content_type_if_absent(&mut header_map, "application/xml"),
                Some("urlencoded") => inject_content_type_if_absent(
                    &mut header_map,
                    "application/x-www-form-urlencoded",
                ),
                _ => {} // text / 无 language → 不注入
            }
            Bytes::from(content.into_bytes())
        }
        Some(RequestBody::FormData { parts }) => build_multipart_body(&parts, &mut header_map)?,
        None => Bytes::new(),
    };

    // Build request
    let mut req_builder = Request::builder().method(method).uri(full_uri);
    for (k, v) in &header_map {
        let lk = k.to_lowercase();
        if lk == "host" || lk == "content-length" || lk == "transfer-encoding" {
            continue;
        }
        req_builder = req_builder.header(k.as_str(), v.as_str());
    }
    let req = req_builder
        .body(Body::empty())
        .map_err(|e| format!("build: {e:?}"))?;
    let (parts, _) = req.into_parts();

    let ctx = ProxyCtx::new(parts.clone(), state.event_channel(), state.settings(), None);

    // Log request event
    record::record_request(&ctx, &body_bytes);

    // Send upstream
    let req = Request::from_parts(parts, Body::from(body_bytes));
    let up = state.settings().proxy.upstream_proxy;
    let svc = client::build_upstream_service(up, false);
    match svc.serve(req).await {
        Ok(resp) => {
            let request_id = record::record_and_drain_response(ctx, resp).await;
            Ok(request_id)
        }
        Err(err) => {
            let msg = format!("{err}");
            ctx.send(ProxyEvent::Error {
                id: ctx.request_id(),
                error: msg,
            });
            Ok(ctx.request_id())
        }
    }
}
