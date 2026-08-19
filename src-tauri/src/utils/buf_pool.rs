use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use bytes::Bytes;
use rama::error::BoxError;
use rama::http::body::CollectOptions;
use rama::http::body::util::BodyExt;
use rama::http::{Body, BodyCaptureEvent, BodyCaptureSink, CaptureBody};

/// body 收集上限（16 MiB）：超过则停止缓冲，剩余部分保持可转发。
pub(crate) const BODY_CAPTURE_LIMIT: usize = 16 * 1024 * 1024;

/// [`collect_body`] 的收集结果。不再返回 `Result`——三种结果各自携带必要信息，
/// 调用方按需 match。
pub(crate) enum CollectedBody {
    /// body 在上限内完整收集。
    Full(Bytes),
    /// 超过 [`BODY_CAPTURE_LIMIT`]：`prefix` 为已读前缀（供日志/展示），
    /// `body` 为重组后的完整 body（前缀 + 未读余量），可原样转发。
    Capped { prefix: Bytes, body: Body },
    /// 流读取中途出错：`prefix` 为出错前已读前缀（供尽力展示），
    /// `error` 为原始错误信息。
    Error { prefix: Bytes, error: BoxError },
}

/// 收集 Body 所有 chunk（带大小上限）。超限时停止缓冲，流错误时保留已读前缀。
/// 调用方对所有三种分支做显式处理。
pub(crate) async fn collect_body(body: Body) -> CollectedBody {
    match body
        .collect_with(CollectOptions::new().with_max_size(BODY_CAPTURE_LIMIT))
        .await
    {
        Ok(collected) => CollectedBody::Full(collected.to_bytes()),
        Err(err) if err.is_cap_reached() => {
            let prefix = err.bytes_read();
            let body = err
                .into_full_body()
                .expect("cap reached implies forwardable remainder");
            CollectedBody::Capped { prefix, body }
        }
        Err(err) => {
            let prefix = err.bytes_read();
            let error: BoxError = err.into();
            CollectedBody::Error { prefix, error }
        }
    }
}

/// 追加 chunk 到累积缓冲，总量超过 [`BODY_CAPTURE_LIMIT`] 后停止（DB 只存前缀）。
/// 截断处按 UTF-8 字符边界回退，避免 panic。
pub(crate) fn push_capped(buf: &mut String, chunk: &str) {
    let room = BODY_CAPTURE_LIMIT.saturating_sub(buf.len());
    if room == 0 {
        return;
    }
    if chunk.len() <= room {
        buf.push_str(chunk);
    } else {
        let mut end = room;
        while !chunk.is_char_boundary(end) {
            end -= 1;
        }
        buf.push_str(&chunk[..end]);
    }
}

/// Body 观测器 trait——实现此 trait 即可接入 [`observe_body`]，
/// 无需自行处理 `Arc`/`Mutex`/drop-安全等并发样板。
pub(crate) trait BodyObserver: Send + 'static {
    /// 每个 chunk 到达时回调。
    fn on_chunk(&mut self, bytes: &Bytes);
    /// 流正常结束或 body 被 drop（客户端断开）时回调，保证只调一次。
    fn on_eos(&mut self);
    /// body 在流结束前被 drop（客户端断开/取消转发）时回调；
    /// 之后仍会调用 [`BodyObserver::on_eos`] 收尾。
    fn on_aborted(&mut self) {}
}

struct ObserverSink<O> {
    state: Arc<(Mutex<O>, AtomicBool)>,
}

fn finish_observer<O: BodyObserver>(state: &(Mutex<O>, AtomicBool), aborted: bool) {
    if !state.1.swap(true, Ordering::AcqRel) {
        let mut observer = state.0.lock().expect("observe_body");
        if aborted {
            observer.on_aborted();
        }
        observer.on_eos();
    }
}

impl<O: BodyObserver> BodyCaptureSink for ObserverSink<O> {
    fn capture(
        &self,
        event: BodyCaptureEvent,
    ) -> impl std::future::Future<Output = ()> + Send + 'static {
        let state = self.state.clone();
        async move {
            match event {
                BodyCaptureEvent::Frame(frame) => {
                    if let Some(bytes) = frame.data_ref() {
                        state.0.lock().expect("observe_body").on_chunk(bytes);
                    }
                }
                BodyCaptureEvent::End(_outcome) => finish_observer(&state, false),
            }
        }
    }

    fn aborted(&self) {
        finish_observer(&self.state, true);
    }
}

/// 逐 chunk 观测骨架：基于 rama 原生 [`CaptureBody`] 流式捕获，无需自行处理
/// stream 包装与 drop-安全并发样板。每个 chunk 到达时调 `observer.on_chunk`；
/// 流正常结束、出错或 body 被 drop 时调 `observer.on_eos`（drop 场景先调
/// `on_aborted`）——由 [`Ordering::AcqRel`] 原子标志保证只执行一次。
pub(crate) fn observe_body(body: Body, observer: impl BodyObserver) -> Body {
    let state = Arc::new((Mutex::new(observer), AtomicBool::new(false)));
    let sink = ObserverSink { state };
    Body::new(CaptureBody::new(body, sink))
}
