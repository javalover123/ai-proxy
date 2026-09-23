use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use bytes::Bytes;
use rama::error::BoxError;
use rama::http::body::CollectOptions;
use rama::http::body::util::BodyExt;
use rama::http::{Body, BodyCaptureEvent, BodyCaptureSink, CaptureBody};

/// 流终止原因，透传 rama 的原始判定。从 [`observe_body`] 起对外只经此别名暴露，
/// 使 buf_pool 成为 rama capture API 的唯一接缝。
pub(crate) use rama::http::CaptureOutcome;

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
    /// 流终止时回调，保证只调一次。`outcome` 必须被消费——终止原因决定这次记录
    /// 是不是完整的：
    ///
    /// - [`CaptureOutcome::Complete`]：上游发出了正常 EOS。
    /// - [`CaptureOutcome::Error`]：上游流中途 yield 了 `Err`，已收到的 body 必然残缺。
    /// - [`CaptureOutcome::Aborted`]：body 在流结束前被 drop（下游断开/取消转发）。
    ///   按 rama 的语义这**不必然**意味着缺字节——消费者读满预期数据后不再 poll
    ///   终止的 `None` 也会走到这里。
    ///
    /// 刻意不提供默认实现：漏处理终止原因曾让异常结束的流被记录成正常完成。
    fn on_end(&mut self, outcome: CaptureOutcome);
}

struct ObserverSink<O> {
    state: Arc<(Mutex<O>, AtomicBool)>,
}

fn finish_observer<O: BodyObserver>(state: &(Mutex<O>, AtomicBool), outcome: CaptureOutcome) {
    if !state.1.swap(true, Ordering::AcqRel) {
        state.0.lock().expect("observe_body").on_end(outcome);
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
                BodyCaptureEvent::End(outcome) => finish_observer(&state, outcome),
            }
        }
    }

    fn aborted(&self) {
        finish_observer(&self.state, CaptureOutcome::Aborted);
    }
}

/// 逐 chunk 观测骨架：基于 rama 原生 [`CaptureBody`] 流式捕获，无需自行处理
/// stream 包装与 drop-安全并发样板。每个 chunk 到达时调 `observer.on_chunk`；
/// 流终止（正常 EOS / 出错 / body 被 drop）时调 `observer.on_end` 并带上原因——
/// 由 [`Ordering::AcqRel`] 原子标志保证只执行一次。
pub(crate) fn observe_body(body: Body, observer: impl BodyObserver) -> Body {
    let state = Arc::new((Mutex::new(observer), AtomicBool::new(false)));
    let sink = ObserverSink { state };
    Body::new(CaptureBody::new(body, sink))
}

#[cfg(test)]
mod tests {
    use std::pin::Pin;
    use std::task::{Context, Poll};

    use rama::http::body::util::BodyExt as _;
    use rama::http::body::{Frame, SizeHint, StreamingBody};

    use super::*;

    /// 先 yield 一个 data frame，再 yield `Err`——模拟上游把流 reset 掉。
    struct FailingBody {
        sent: bool,
    }

    impl StreamingBody for FailingBody {
        type Data = Bytes;
        type Error = std::io::Error;

        fn poll_frame(
            mut self: Pin<&mut Self>,
            _cx: &mut Context<'_>,
        ) -> Poll<Option<Result<Frame<Self::Data>, Self::Error>>> {
            if self.sent {
                Poll::Ready(Some(Err(std::io::Error::other("upstream reset"))))
            } else {
                self.sent = true;
                Poll::Ready(Some(Ok(Frame::data(Bytes::from_static(b"hello")))))
            }
        }

        fn size_hint(&self) -> SizeHint {
            SizeHint::default()
        }
    }

    #[derive(Default)]
    struct Recorder {
        chunks: Vec<Bytes>,
        end: Option<CaptureOutcome>,
    }

    /// 把回调结果写进共享 slot 供断言读取。
    struct SharedObserver(Arc<Mutex<Recorder>>);

    impl BodyObserver for SharedObserver {
        fn on_chunk(&mut self, bytes: &Bytes) {
            self.0.lock().expect("recorder").chunks.push(bytes.clone());
        }

        fn on_end(&mut self, outcome: CaptureOutcome) {
            let mut rec = self.0.lock().expect("recorder");
            assert!(rec.end.is_none(), "on_end 必须只触发一次");
            rec.end = Some(outcome);
        }
    }

    fn observed(body: Body) -> (Body, Arc<Mutex<Recorder>>) {
        let rec = Arc::new(Mutex::new(Recorder::default()));
        (observe_body(body, SharedObserver(rec.clone())), rec)
    }

    fn end_of(rec: &Arc<Mutex<Recorder>>) -> Option<CaptureOutcome> {
        rec.lock().expect("recorder").end
    }

    /// 回归用例：上游流中途出错必须报 [`CaptureOutcome::Error`]，不能被当成正常
    /// EOS——否则半截响应会被落库并 finalize 成一次干净完成。
    #[tokio::test]
    async fn stream_error_reports_error_outcome() {
        let (body, rec) = observed(Body::new(FailingBody { sent: false }));

        assert!(body.collect().await.is_err(), "错误必须继续透传给下游");

        assert_eq!(end_of(&rec), Some(CaptureOutcome::Error));
        assert_eq!(
            rec.lock().expect("recorder").chunks,
            vec![Bytes::from_static(b"hello")],
            "出错前已到的 chunk 仍应被观测到"
        );
    }

    #[tokio::test]
    async fn normal_stream_reports_complete_outcome() {
        let (body, rec) = observed(Body::from(Bytes::from_static(b"hi")));

        body.collect().await.expect("collect");

        assert_eq!(end_of(&rec), Some(CaptureOutcome::Complete));
    }

    /// body 在流结束前被 drop（下游断开）走同步 `aborted()` 通道。
    #[test]
    fn dropping_body_before_eos_reports_aborted_outcome() {
        let (body, rec) = observed(Body::from(Bytes::from_static(b"hi")));

        drop(body);

        assert_eq!(end_of(&rec), Some(CaptureOutcome::Aborted));
    }
}
