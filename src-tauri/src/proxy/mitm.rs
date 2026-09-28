use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::Arc;

use rama::Layer;
use rama::Service;
use rama::extensions::ExtensionsRef;
use rama::http::Method;
use rama::http::layer::upgrade::Upgraded;
use rama::http::layer::{
    map_response_body::MapResponseBodyLayer,
    remove_header::{RemoveRequestHeaderLayer, RemoveResponseHeaderLayer},
    trace::TraceLayer,
};
use rama::http::server::HttpServer;
use rama::io::Io;
use rama::layer::AddInputExtensionLayer;
use rama::layer::ConsumeErrLayer;
use rama::layer::timeout::TimeoutLayer;
use rama::net::Protocol;
use rama::net::address::HostWithPort;
use rama::net::proxy::IoForwardService;
use rama::net::uri::Uri;
use rama::rt::Executor;
use rama::service::service_fn;
use rama::tcp::proxy::IoToProxyBridgeIoLayer;
use rama::tls::rustls::server::TlsAcceptorLayer;
use rama::tls::server::peek_client_hello_from_input;

use super::client::forward_to_upstream;
use super::events::ProxyEvent;
use super::ext::RequestExt;
use super::layer::authz::ExtAuthzLayer;
use super::layer::direct::direct_reply_layer;
use super::layer::script::ScriptLayer;
use super::layer::traffic_record::TrafficRecorderLayer;
use super::state::{State, ViaConnectTunnel};

pub(crate) async fn http_connect_proxy(upgraded: Upgraded) -> Result<(), Infallible> {
    let start_ts = crate::utils::date::now_ms();
    let state: State = upgraded.ext::<State>();

    let peek_timeout = Some(std::time::Duration::from_secs(30));
    // 通过检查 TLS ClientHello 来决定是否进行 MITM
    let (prefixed, maybe_client_hello) =
        match peek_client_hello_from_input(upgraded, peek_timeout).await {
            Ok(result) => result,
            Err(err) => {
                log::warn!("peek TLS ClientHello failed: {:?}", err);
                return Ok(());
            }
        };

    let sni = maybe_client_hello
        .as_ref()
        .and_then(|ch| ch.ext_server_name().map(|s| s.to_string()));

    // SNI 命中已启用的 MITM 白名单 → 解密；否则（无 SNI 或未命中）→ 隧道透传。
    match sni {
        Some(host) if state.settings().tls.should_mitm(&host) => {
            log::info!(
                "CONNECT TLS, SNI={}, in MITM whitelist, routing to MITM",
                host
            );
            // 把隧道解密后的流量重新解析成 HTTP 语义
            let http_mitm_service = (
                AddInputExtensionLayer::new(ViaConnectTunnel),
                AddInputExtensionLayer::new(crate::proxy::state::StartTime(start_ts)),
            )
                .into_layer(new_http_mitm_proxy());
            let http_transport = HttpServer::auto(Executor::default()).service(http_mitm_service);
            let https_service = TlsAcceptorLayer::new(state.mitm_tls_service_data().clone())
                .with_store_client_hello(true)
                .into_layer(http_transport);

            if let Err(err) = https_service.serve(prefixed).await {
                if is_timeout_err(&err) {
                    // TLS 握手已成功，仅是连接空闲/预连接超过 header_read_timeout(30s)
                    // 未发请求头，属正常连接回收，非故障。
                    log::debug!(
                        "MITM connection to {} idle-closed (no request): {:?}",
                        host,
                        err
                    );
                } else {
                    log::warn!("MITM session failed for {}: {:?}", host, err);
                }
            }
        }
        _maybe_host => {
            // 用 ClientHello 是否存在来判断 TLS，而非 SNI 是否存在。
            // TLS 连接可能没有 SNI 扩展（maybe_client_hello 为 Some 但 maybe_host 为 None），
            // 此时仍应视为 HTTPS 隧道。
            let protocol = maybe_client_hello
                .as_ref()
                .map_or(Protocol::HTTP, |_| Protocol::HTTPS);
            let authority = prefixed
                .extensions()
                .get_ref::<rama::net::client::ConnectorTarget>()
                .map(|t| t.0.clone());
            log::info!(
                "CONNECT {}: not in MITM whitelist, routing to tunnel",
                authority
                    .as_ref()
                    .map(|a| a.to_string())
                    .unwrap_or_default()
            );
            tunnel_connect_proxy(state, prefixed, protocol, authority, start_ts).await;
        }
    }
    Ok(())
}

/// 隧道路径：不解密 TLS，直接双向字节桥接。
async fn tunnel_connect_proxy<P>(
    state: State,
    prefixed: P,
    protocol: Protocol,
    authority: Option<HostWithPort>,
    start_ts: i64,
) where
    P: Io + ExtensionsRef + std::marker::Unpin,
{
    let request_id = crate::storage::id::next_request_id();
    // 仅记录已解密的流量：开启时未解密（隧道透传）请求不再上报前端。
    let event_channel = if state.settings().tls.record_decrypted_only {
        None
    } else {
        state.event_channel()
    };
    let uri = authority
        .as_ref()
        .map(|a| Uri::from_authority(protocol.clone(), a.clone()).to_string())
        .unwrap_or_else(|| protocol.as_str().to_string());
    let host_value = authority
        .as_ref()
        .map(|a| a.to_string())
        .unwrap_or_default();

    let mut headers = HashMap::new();
    headers.insert("Host".into(), host_value);

    // Emit Request event for tunnel connection
    if let Some(ref ch) = event_channel {
        ch.send(ProxyEvent::Request {
            id: request_id,
            method: Method::CONNECT.as_str().into(),
            uri: uri.clone(),
            timestamp: start_ts,
            headers,
            query_params: HashMap::new(),
            decrypted: false,
            content_type: None,
        })
        .ok();
    }

    let executor = Executor::default();
    let tunnel_svc = (TimeoutLayer::new(std::time::Duration::from_secs(30)),).into_layer(
        IoToProxyBridgeIoLayer::extension_connector_target()
            .with_connector(rama::dns::client::DnsConnector::new(
                rama::tcp::client::service::TcpConnector::new(),
            ))
            .into_layer(
                IoForwardService::new(executor)
                    .with_first_byte_timeout(std::time::Duration::from_secs(30)),
            ),
    );

    let tunnel_result = tunnel_svc.serve(prefixed).await;
    let end_ts = crate::utils::date::now_ms();
    let duration_ms = (end_ts - start_ts) as u64;

    match tunnel_result {
        Ok(outcome) => {
            log::info!(
                "[tunnel] closed: reason={:?}, bytes_l_to_r={}, bytes_r_to_l={}, age={:?}",
                outcome.reason(),
                outcome.bytes_l_to_r(),
                outcome.bytes_r_to_l(),
                outcome.age(),
            );
            if let Some(err) = outcome.fatal_error() {
                log::debug!("[tunnel] benign close: {err}");
            }
            if let Some(ref ch) = event_channel {
                ch.send(ProxyEvent::Response {
                    id: request_id,
                    status: 200,
                    timestamp: end_ts,
                    duration_ms,
                    headers: HashMap::new(),
                    content_type: None,
                })
                .ok();
            }
        }
        Err(err) => {
            log::warn!("tunnel forwarding failed: {:?}", err);
            if let Some(ref ch) = event_channel {
                ch.send(ProxyEvent::Error {
                    id: request_id,
                    error: format!("{err:?}"),
                })
                .ok();
            }
        }
    }
}

/// 错误链中是否为超时（如 HTTP header read timeout）。
/// 用于区分空闲连接回收（无害）与真正的 TLS/HTTP 失败。
fn is_timeout_err(err: &rama::error::BoxError) -> bool {
    let mut cur: Option<&(dyn std::error::Error + 'static)> = err.source();
    while let Some(e) = cur {
        if let Some(http_err) = e.downcast_ref::<rama::http::core::Error>()
            && http_err.is_timeout()
        {
            return true;
        }
        cur = e.source();
    }
    false
}

pub(crate) fn new_http_mitm_proxy()
-> impl Service<rama::http::Request, Output = rama::http::Response, Error = Infallible> + Clone {
    Arc::new(
        (
            // HijackLayer must be outermost: direct requests bypass the entire proxy pipeline.
            direct_reply_layer(),
            MapResponseBodyLayer::new_boxed_streaming_body(),
            TraceLayer::new_for_http(),
            ConsumeErrLayer::default(),
            RemoveResponseHeaderLayer::hop_by_hop(),
            RemoveRequestHeaderLayer::hop_by_hop(),
            // 授权先于脚本：被拒的请求在此短路，不进入 ScriptLayer / 录制 / 转发。
            ExtAuthzLayer,
            ScriptLayer,
            // TrafficRecorderLayer is the error boundary:
            // BoxError from forward_to_upstream → Infallible via error_response.
            TrafficRecorderLayer,
        )
            .into_layer(service_fn(forward_to_upstream)),
    )
}
