use std::time::Duration;

use rama::error::BoxError;
use rama::http::client::EasyHttpWebClient;
use rama::http::layer::decompression::DecompressionLayer;
use rama::http::layer::map_response_body::MapResponseBodyLayer;
use rama::http::layer::timeout::{ResponseBodyTimeoutLayer, TimeoutLayer};
use rama::http::{Request, Response, StatusCode, Version};
use rama::layer::Layer;
use rama::rt::Executor;
use rama::service::BoxService;
use rama::service::Service;
use rama::tls::client::{ServerVerifyMode, TlsClientConfig};

use super::ext::RequestExt;
use super::state::State;

/// Pure upstream forwarding — no recording or error handling.
/// Traffic recording, DB persistence, AI pipeline, and error-to-Infallible
/// conversion are handled by [`super::layer::traffic_record::TrafficRecorderLayer`].
pub(crate) async fn forward_to_upstream(req: Request) -> Result<Response, BoxError> {
    log::info!(
        "MITM request: {} {} ({:?})",
        req.method(),
        req.uri(),
        req.version()
    );

    let state: State = req.ext();
    // RwLockReadGuard from state.settings() is dropped before the await point,
    // keeping the future Send-compatible.
    state.upstream_client().serve(req).await
}

pub(crate) fn build_upstream_service(
    upstream_proxy: bool,
    skip_tls_verify: bool,
) -> BoxService<Request, Response, BoxError> {
    use std::sync::OnceLock;

    /// 用两位 bool 索引 4 种组合，一次写入后无锁命中。
    fn cache_key(up: bool, skip: bool) -> usize {
        ((up as usize) << 1) | (skip as usize)
    }

    static CACHE: [OnceLock<BoxService<Request, Response, BoxError>>; 4] = [
        OnceLock::new(),
        OnceLock::new(),
        OnceLock::new(),
        OnceLock::new(),
    ];

    let idx = cache_key(upstream_proxy, skip_tls_verify);
    if let Some(svc) = CACHE[idx].get() {
        return svc.clone();
    }

    // 跳过 TLS 验证（不安全，仅用于测试）
    let tls_config = if skip_tls_verify {
        TlsClientConfig::default_http().with_server_verify(ServerVerifyMode::Disable)
    } else {
        TlsClientConfig::default_http()
    };

    let client = if upstream_proxy {
        EasyHttpWebClient::connector_builder()
            .with_default_transport_connector()
            .with_default_dns_connector()
            .with_tls_proxy_support_using_rustls()
            .with_proxy_support()
            .with_tls_support_using_rustls_and_default_http_version(tls_config, Version::HTTP_11)
            .with_default_http_connector(Executor::default())
            .with_default_connection_pool()
            .build_client()
    } else {
        EasyHttpWebClient::connector_builder()
            .with_default_transport_connector()
            .with_default_dns_connector()
            .with_tls_proxy_support_using_rustls()
            .without_proxy_support()
            .with_tls_support_using_rustls_and_default_http_version(tls_config, Version::HTTP_11)
            .with_default_http_connector(Executor::default())
            .with_default_connection_pool()
            .build_client()
    };

    let svc = (
        MapResponseBodyLayer::new_boxed_streaming_body(),
        DecompressionLayer::new().with_insert_accept_encoding_header(false),
        // 300s overall timeout as safety net against hung requests
        TimeoutLayer::with_status_code(StatusCode::GATEWAY_TIMEOUT, Duration::from_secs(300)),
        // 60s per-chunk timeout: kills dead connections quickly while
        // streaming AI responses can run arbitrarily long under the 300s cap
        ResponseBodyTimeoutLayer::new(Duration::from_secs(60)),
    )
        .into_layer(client)
        .boxed();

    // get_or_init：多个请求竞争时只有第一个构建，其余等待后复用。
    CACHE[idx].get_or_init(|| svc).clone()
}
