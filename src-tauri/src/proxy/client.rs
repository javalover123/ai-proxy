use std::time::Duration;

use rama::error::BoxError;
use rama::http::client::EasyHttpWebClient;
use rama::http::layer::decompression::DecompressionLayer;
use rama::http::layer::map_response_body::MapResponseBodyLayer;
use rama::http::layer::timeout::{ResponseBodyTimeoutLayer, TimeoutLayer};
use rama::http::{Request, Response, StatusCode, Version};
use rama::layer::Layer;
use rama::net::address::ProxyAddress;
use rama::net::client::ProxyAddressLayer;
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
    upstream_proxy: Option<ProxyAddress>,
    skip_tls_verify: bool,
) -> BoxService<Request, Response, BoxError> {
    // 代理地址来自运行时配置，不参与缓存：只把 client 按 skip_tls_verify 缓存两份，
    // 每次调用外挂一层 ProxyAddressLayer（往 extensions 写 ProxyRoute）。
    // 连接池的分组标识 HttpConnIdentifier 已包含所选路由，
    // 因此同一个池不会把不同代理（或代理与直连）的连接串用。
    ProxyAddressLayer::maybe(upstream_proxy)
        .into_layer(cached_client(skip_tls_verify))
        .boxed()
}

/// 上游 client（含超时/解压/流标准化），按 `skip_tls_verify` 缓存，首次调用时构建。
fn cached_client(skip_tls_verify: bool) -> BoxService<Request, Response, BoxError> {
    use std::sync::OnceLock;

    static CACHE: [OnceLock<BoxService<Request, Response, BoxError>>; 2] =
        [OnceLock::new(), OnceLock::new()];

    let slot = &CACHE[usize::from(skip_tls_verify)];
    if let Some(svc) = slot.get() {
        return svc.clone();
    }

    // 跳过 TLS 验证（不安全，仅用于测试）
    let tls_config = if skip_tls_verify {
        TlsClientConfig::default_http().with_server_verify(ServerVerifyMode::Disable)
    } else {
        TlsClientConfig::default_http()
    };

    // with_proxy_support 装的是 HttpProxyConnector::optional：
    // 没有 ProxyRoute 时直接回落直连，所以无需再区分「带代理/不带代理」两种 client。
    let client = EasyHttpWebClient::connector_builder()
        .with_default_transport_connector()
        .with_default_dns_connector()
        .with_tls_proxy_support_using_rustls()
        .with_proxy_support()
        .with_tls_support_using_rustls_and_default_http_version(tls_config, Version::HTTP_11)
        .with_default_http_connector(Executor::default())
        .with_default_connection_pool()
        .build_client();

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
    slot.get_or_init(|| svc).clone()
}

/// extAuthz 授权检查用的**直连**客户端：不上游代理、不内置超时（超时由调用方
/// 按规则 `timeout_ms` 用 `tokio::time::timeout` 施加）。TLS 校验姿态与上游一致
/// （skip-verify，适配自签名测试环境）。
pub(crate) fn authz_client() -> BoxService<Request, Response, BoxError> {
    use std::sync::OnceLock;

    static CLIENT: OnceLock<BoxService<Request, Response, BoxError>> = OnceLock::new();

    CLIENT
        .get_or_init(|| {
            // 跳过 TLS 验证（与上游 client 同一种信任假设）
            let tls_config =
                TlsClientConfig::default_http().with_server_verify(ServerVerifyMode::Disable);

            // 直连：无 ProxyRoute 注入，`with_proxy_support` 的 optional 连接器回落直连，
            // 不会经上游代理转发。TLS 校验姿态与上游 client 一致（skip-verify）。
            let client = EasyHttpWebClient::connector_builder()
                .with_default_transport_connector()
                .with_default_dns_connector()
                .with_tls_proxy_support_using_rustls()
                .with_proxy_support()
                .with_tls_support_using_rustls_and_default_http_version(
                    tls_config,
                    Version::HTTP_11,
                )
                .with_default_http_connector(Executor::default())
                .with_default_connection_pool()
                .build_client();

            (
                MapResponseBodyLayer::new_boxed_streaming_body(),
                DecompressionLayer::new().with_insert_accept_encoding_header(false),
            )
                .into_layer(client)
                .boxed()
        })
        .clone()
}
