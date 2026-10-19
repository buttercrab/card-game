//! Bounded socket delivery. Reservations include the frame currently being sent.
//! These are source-byte limits, not a promise about allocator or TLS overhead.
use axum::extract::ws::{CloseFrame, Message};
use futures_util::{Sink, SinkExt};
use serde::Serialize;
use std::sync::{Arc, Weak};
use tokio::sync::{OwnedSemaphorePermit, Semaphore, mpsc, watch};

#[derive(Clone, Copy, Debug)]
pub struct Policy {
    pub message_bytes: usize,
    pub connection_bytes: usize,
    pub frames: usize,
    pub global_bytes: usize,
}
impl Default for Policy {
    fn default() -> Self {
        Self {
            message_bytes: 4 << 20,
            connection_bytes: 16 << 20,
            frames: 256,
            global_bytes: 64 << 20,
        }
    }
}
impl Policy {
    pub fn validate(self) -> Result<Self, &'static str> {
        if self.message_bytes == 0
            || self.frames == 0
            || self.message_bytes > u32::MAX as usize
            || self.message_bytes > self.connection_bytes
            || self.connection_bytes > self.global_bytes
            || self.global_bytes > Semaphore::MAX_PERMITS
            || self.frames > Semaphore::MAX_PERMITS
        {
            return Err("invalid outbound limits");
        }
        // Three maximum Session checkpoints can be queued during authentication.
        // Smaller explicit policies are supported, but must retain this burst runway.
        if self.connection_bytes / self.message_bytes < 4 {
            return Err("outbound connection limit requires four message budgets for bootstrap");
        }
        Ok(self)
    }
}
#[derive(Clone)]
pub struct Pool {
    policy: Policy,
    bytes: Arc<Semaphore>,
}
impl Pool {
    pub fn new(policy: Policy) -> Result<Self, &'static str> {
        let policy = policy.validate()?;
        Ok(Self {
            policy,
            bytes: Arc::new(Semaphore::new(policy.global_bytes)),
        })
    }
    #[cfg(test)]
    pub(crate) fn available_bytes(&self) -> usize {
        self.bytes.available_permits()
    }
    pub fn channel(&self) -> (Sender, Receiver) {
        let (tx, rx) = mpsc::channel(self.policy.frames);
        let (abort, _) = watch::channel(None);
        let (closing, _) = watch::channel(false);
        let state = Arc::new(State {
            policy: self.policy,
            bytes: Arc::new(Semaphore::new(self.policy.connection_bytes)),
            frames: Arc::new(Semaphore::new(self.policy.frames)),
            global: self.bytes.clone(),
            abort,
            closing,
        });
        (
            Sender {
                tx,
                state: state.clone(),
            },
            Receiver { rx, state },
        )
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AbortCause {
    MessageTooLarge,
    Backpressure,
    Closed,
}
impl AbortCause {
    pub fn close(self) -> CloseFrame {
        let (code, reason) = match self {
            Self::MessageTooLarge => (1009, "outbound_message_limit"),
            Self::Backpressure => (1013, "outbound_backpressure"),
            Self::Closed => (1000, "outbound_closed"),
        };
        CloseFrame {
            code,
            reason: reason.into(),
        }
    }
}
struct State {
    policy: Policy,
    bytes: Arc<Semaphore>,
    frames: Arc<Semaphore>,
    global: Arc<Semaphore>,
    abort: watch::Sender<Option<AbortCause>>,
    closing: watch::Sender<bool>,
}
impl State {
    fn abort(&self, cause: AbortCause) {
        self.abort.send_if_modified(|value| {
            if value.is_none() {
                *value = Some(cause);
                true
            } else {
                false
            }
        });
    }
    fn cause(&self) -> Option<AbortCause> {
        *self.abort.borrow()
    }
}
struct Frame {
    text: String,
    _permits: [OwnedSemaphorePermit; 3],
}
/// A complete encoded frame whose source bytes and frame slot are already
/// charged while a room checkpoint is pending. No socket side effect occurs
/// until delivery after commit. Dropping it releases every reservation.
pub(crate) struct PreparedFrame {
    frame: Frame,
    owner: Weak<State>,
}
#[derive(Clone)]
pub struct Sender {
    tx: mpsc::Sender<Frame>,
    state: Arc<State>,
}
impl Drop for Sender {
    fn drop(&mut self) {
        if self.tx.strong_count() == 1 {
            self.state.closing.send_replace(true);
        }
    }
}
pub struct WeakSender {
    tx: mpsc::WeakSender<Frame>,
    state: Weak<State>,
}
impl WeakSender {
    pub fn upgrade(&self) -> Option<Sender> {
        Some(Sender {
            tx: self.tx.upgrade()?,
            state: self.state.upgrade()?,
        })
    }
}
impl Sender {
    pub fn downgrade(&self) -> WeakSender {
        WeakSender {
            tx: self.tx.downgrade(),
            state: Arc::downgrade(&self.state),
        }
    }
    #[cfg(test)]
    pub(crate) fn abort_cause(&self) -> Option<AbortCause> {
        self.state.cause()
    }
    pub fn abort(&self, cause: AbortCause) {
        self.state.abort(cause);
    }
    fn reserve(&self, bytes: usize) -> Result<[OwnedSemaphorePermit; 3], AbortCause> {
        if let Some(cause) = self.state.cause() {
            return Err(cause);
        }
        if bytes > self.state.policy.message_bytes {
            return Err(AbortCause::MessageTooLarge);
        }
        let bytes = u32::try_from(bytes).map_err(|_| AbortCause::MessageTooLarge)?;
        let reserve = || {
            Some([
                self.state.bytes.clone().try_acquire_many_owned(bytes).ok()?,
                self.state.global.clone().try_acquire_many_owned(bytes).ok()?,
                self.state.frames.clone().try_acquire_owned().ok()?,
            ])
        };
        reserve().ok_or(AbortCause::Backpressure)
    }

    /// Count before allocating encoded source, then charge the existing shared
    /// delivery budget before encoding. Refusal is pure: the room decides when
    /// an abort may be published, after its authoritative checkpoint commits.
    pub(crate) fn prepare<T: Serialize>(&self, value: &T) -> Result<PreparedFrame, AbortCause> {
        fn cause(error: crate::resource_budget::BudgetError) -> AbortCause {
            match error {
                crate::resource_budget::BudgetError::Capacity { .. } => AbortCause::MessageTooLarge,
                _ => AbortCause::Closed,
            }
        }
        let measured = crate::resource_budget::serialized_size_capped(
            value,
            crate::resource_budget::Resource::Session,
            self.state.policy.message_bytes,
        )
        .map_err(cause)?;
        let permits = self.reserve(measured)?;
        let bytes =
            crate::resource_budget::serialize_capped(value, crate::resource_budget::Resource::Session, measured)
                .map_err(cause)?;
        // Native serializers are inert. Reject a changing/custom serializer
        // rather than silently retain source bytes outside its reservation.
        if bytes.len() != measured {
            return Err(AbortCause::Closed);
        }
        Ok(PreparedFrame {
            frame: Frame {
                text: String::from_utf8(bytes).expect("JSON is UTF-8"),
                _permits: permits,
            },
            owner: Arc::downgrade(&self.state),
        })
    }

    pub(crate) fn deliver(&self, prepared: PreparedFrame) -> Result<(), AbortCause> {
        if !prepared
            .owner
            .upgrade()
            .is_some_and(|owner| Arc::ptr_eq(&owner, &self.state))
        {
            // Never send an old connection's private frame to its replacement.
            return Err(AbortCause::Closed);
        }
        if let Some(cause) = self.state.cause() {
            return Err(cause);
        }
        self.tx.try_send(prepared.frame).map_err(|error| {
            let cause = if matches!(error, mpsc::error::TrySendError::Closed(_)) {
                AbortCause::Closed
            } else {
                AbortCause::Backpressure
            };
            self.state.abort(cause);
            cause
        })
    }

    pub fn send(&self, text: String) -> Result<(), AbortCause> {
        let permits = self.reserve(text.len()).inspect_err(|cause| self.state.abort(*cause))?;
        self.deliver(PreparedFrame {
            frame: Frame {
                text,
                _permits: permits,
            },
            owner: Arc::downgrade(&self.state),
        })
    }
}
pub struct Receiver {
    rx: mpsc::Receiver<Frame>,
    state: Arc<State>,
}
impl Drop for Receiver {
    fn drop(&mut self) {
        self.state.abort(AbortCause::Closed);
        self.rx.close();
        while self.rx.try_recv().is_ok() {}
    }
}
impl Receiver {
    #[cfg(test)]
    pub async fn recv(&mut self) -> Option<String> {
        self.rx.recv().await.map(|frame| frame.text)
    }
    #[cfg(test)]
    pub fn try_recv(&mut self) -> Result<String, mpsc::error::TryRecvError> {
        self.rx.try_recv().map(|frame| frame.text)
    }
}
/// Abort wins even while the sink is permanently blocked. The close handshake is
/// best effort and bounded; dropping the sink then releases its buffered frames.
pub async fn write<S>(sink: S, receiver: Receiver)
where
    S: Sink<Message> + Unpin,
{
    let mut closing = receiver.state.closing.subscribe();
    let writer = write_inner(sink, receiver);
    tokio::pin!(writer);
    tokio::select! { biased;
        _ = &mut writer => {},
        _ = async { while !*closing.borrow() { if closing.changed().await.is_err() { break; } } } => {
            // Let a normal final TableGone/control frame drain, but never retain
            // a stopped room's socket or reservations behind a blocked peer.
            let _ = tokio::time::timeout(std::time::Duration::from_millis(100), &mut writer).await;
        }
    }
}
async fn write_inner<S>(mut sink: S, mut receiver: Receiver)
where
    S: Sink<Message> + Unpin,
{
    let mut cancellation = receiver.state.abort.subscribe();
    let mut interrupted = None;
    let cause = loop {
        let mut frame = tokio::select! { biased;
            _ = async { while cancellation.borrow().is_none() { if cancellation.changed().await.is_err() { break; } } } => break receiver.state.cause().unwrap_or(AbortCause::Closed),
            frame = receiver.rx.recv() => match frame { Some(frame) => frame, None => break AbortCause::Closed },
        };
        let result = tokio::select! { biased;
            _ = async { while cancellation.borrow().is_none() { if cancellation.changed().await.is_err() { break; } } } => None,
            result = sink.send(Message::Text(std::mem::take(&mut frame.text).into())) => Some(result),
        };
        // Keep permits alive through the entire send, including its flush.
        match result {
            Some(Ok(())) => drop(frame),
            Some(Err(_)) => {
                interrupted = Some(frame);
                break AbortCause::Closed;
            }
            None => {
                interrupted = Some(frame);
                break receiver.state.cause().unwrap_or(AbortCause::Closed);
            }
        }
    };
    // Release queued permits immediately, without waiting for a slow close.
    receiver.rx.close();
    while receiver.rx.try_recv().is_ok() {}
    let _ = tokio::time::timeout(
        std::time::Duration::from_millis(100),
        sink.send(Message::Close(Some(cause.close()))),
    )
    .await;
    drop(sink);
    drop(interrupted);
}
#[cfg(test)]
pub fn test_channel() -> (Sender, Receiver) {
    Pool::new(Policy::default()).unwrap().channel()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        pin::Pin,
        sync::atomic::{AtomicBool, Ordering},
        task::{Context, Poll},
    };
    fn pool() -> Pool {
        Pool::new(Policy {
            message_bytes: 32,
            connection_bytes: 128,
            frames: 8,
            global_bytes: 256,
        })
        .unwrap()
    }
    #[test]
    fn prepared_source_is_charged_before_commit_and_transfers_without_double_reservation() {
        let pool = pool();
        let (sender, mut receiver) = pool.channel();
        let prepared = sender.prepare(&"hello").unwrap();
        assert_eq!(pool.available_bytes(), 256 - 7);
        assert!(receiver.try_recv().is_err());
        assert_eq!(sender.abort_cause(), None);
        sender.deliver(prepared).unwrap();
        assert_eq!(pool.available_bytes(), 256 - 7);
        assert_eq!(receiver.try_recv().unwrap(), "\"hello\"");
        assert_eq!(pool.available_bytes(), 256);
        drop(sender.prepare(&"hello").unwrap());
        assert_eq!(pool.available_bytes(), 256);
    }

    #[test]
    fn replacement_connection_never_receives_or_aborts_from_old_prepared_frame() {
        let pool = pool();
        let (old, mut old_rx) = pool.channel();
        let (replacement, mut new_rx) = pool.channel();
        let prepared = old.prepare(&"private").unwrap();
        assert!(matches!(replacement.deliver(prepared), Err(AbortCause::Closed)));
        assert_eq!(pool.available_bytes(), 256);
        assert!(old_rx.try_recv().is_err());
        assert!(new_rx.try_recv().is_err());
        assert_eq!(old.abort_cause(), None);
        assert_eq!(replacement.abort_cause(), None);
    }

    #[test]
    fn changing_serializer_releases_reservation_and_never_publishes_abort() {
        struct Changing(std::cell::Cell<bool>);
        impl serde::Serialize for Changing {
            fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                serializer.serialize_str(if self.0.replace(false) { "longer" } else { "a" })
            }
        }
        let pool = pool();
        let (sender, mut receiver) = pool.channel();
        assert!(matches!(
            sender.prepare(&Changing(std::cell::Cell::new(true))),
            Err(AbortCause::Closed)
        ));
        assert_eq!(pool.available_bytes(), 256);
        assert_eq!(sender.abort_cause(), None);
        assert!(receiver.try_recv().is_err());
    }

    #[test]
    fn bootstrap_headroom_counts_inflight_and_releases_every_reservation() {
        let pool = pool();
        let (sender, mut receiver) = pool.channel();
        sender.send("s".repeat(32)).unwrap();
        let inflight = receiver.rx.try_recv().unwrap();
        sender.send("s".repeat(32)).unwrap();
        sender.send("s".repeat(32)).unwrap();
        sender.send("c".repeat(31)).unwrap();
        assert_eq!(pool.bytes.available_permits(), 129);
        assert_eq!(sender.send("xx".into()), Err(AbortCause::Backpressure));
        drop(receiver);
        assert_eq!(pool.bytes.available_permits(), 224);
        drop(inflight);
        assert_eq!(pool.bytes.available_permits(), 256);
    }
    #[test]
    fn global_and_frame_limits_are_independent_and_include_inflight() {
        let pool = Pool::new(Policy {
            message_bytes: 4,
            connection_bytes: 16,
            frames: 2,
            global_bytes: 16,
        })
        .unwrap();
        let (a, mut ar) = pool.channel();
        let (b, br) = pool.channel();
        a.send("1234".into()).unwrap();
        let frame = ar.rx.try_recv().unwrap();
        a.send("1234".into()).unwrap();
        assert_eq!(a.send(String::new()), Err(AbortCause::Backpressure));
        b.send("1234".into()).unwrap();
        b.send("1234".into()).unwrap();
        let (c, cr) = pool.channel();
        assert_eq!(c.send("a".into()), Err(AbortCause::Backpressure));
        drop((ar, br, cr, frame));
        assert_eq!(pool.bytes.available_permits(), 16);
    }
    #[test]
    fn oversized_utf8_and_capped_json_are_permanent_refusals() {
        let pool = pool();
        let (sender, mut receiver) = pool.channel();
        assert_eq!(sender.send("가".repeat(11)), Err(AbortCause::MessageTooLarge));
        assert!(receiver.try_recv().is_err());
        assert_eq!(pool.bytes.available_permits(), 256);
        let (sender, mut receiver) = pool.channel();
        assert!(matches!(
            sender.prepare(&"\n".repeat(20)),
            Err(AbortCause::MessageTooLarge)
        ));
        assert!(receiver.try_recv().is_err());
        assert_eq!(
            sender.state.cause(),
            None,
            "candidate encoding must not publish a close"
        );
        sender.send("still committed".into()).unwrap();
        assert_eq!(AbortCause::MessageTooLarge.close().code, 1009);
        assert_eq!(AbortCause::Backpressure.close().code, 1013);
    }
    struct Blocked {
        dropped: Arc<AtomicBool>,
    }
    impl Drop for Blocked {
        fn drop(&mut self) {
            self.dropped.store(true, Ordering::SeqCst);
        }
    }
    impl Sink<Message> for Blocked {
        type Error = ();
        fn poll_ready(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), ()>> {
            Poll::Pending
        }
        fn start_send(self: Pin<&mut Self>, _: Message) -> Result<(), ()> {
            unreachable!()
        }
        fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), ()>> {
            Poll::Pending
        }
        fn poll_close(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), ()>> {
            Poll::Pending
        }
    }
    #[tokio::test(start_paused = true)]
    async fn saturated_socket_aborts_even_when_sink_send_never_completes() {
        let pool = pool();
        let (sender, receiver) = pool.channel();
        sender.send("x".repeat(32)).unwrap();
        let dropped = Arc::new(AtomicBool::new(false));
        let writer = tokio::spawn(write(
            Blocked {
                dropped: dropped.clone(),
            },
            receiver,
        ));
        tokio::task::yield_now().await;
        for _ in 0..3 {
            sender.send("x".repeat(32)).unwrap();
        }
        assert_eq!(sender.send("x".into()), Err(AbortCause::Backpressure));
        tokio::time::timeout(std::time::Duration::from_secs(1), writer)
            .await
            .unwrap()
            .unwrap();
        assert!(dropped.load(Ordering::SeqCst));
        assert_eq!(pool.bytes.available_permits(), 256);
    }
    #[tokio::test(start_paused = true)]
    async fn last_producer_close_releases_a_blocked_inflight_frame() {
        let pool = pool();
        let (sender, receiver) = pool.channel();
        sender.send("x".repeat(32)).unwrap();
        let dropped = Arc::new(AtomicBool::new(false));
        let writer = tokio::spawn(write(
            Blocked {
                dropped: dropped.clone(),
            },
            receiver,
        ));
        tokio::task::yield_now().await;
        drop(sender);
        tokio::time::timeout(std::time::Duration::from_secs(1), writer)
            .await
            .unwrap()
            .unwrap();
        assert!(dropped.load(Ordering::SeqCst));
        assert_eq!(pool.bytes.available_permits(), 256);
    }
    #[test]
    fn default_budget_admits_three_maximum_session_frames_and_control() {
        let pool = Pool::new(Policy::default()).unwrap();
        let (sender, mut receiver) = pool.channel();
        let maximum = Policy::default().message_bytes;
        sender.send("s".repeat(maximum)).unwrap();
        let inflight = receiver.rx.try_recv().unwrap();
        sender.send("s".repeat(maximum)).unwrap();
        sender.send("s".repeat(maximum)).unwrap();
        sender.send("c".repeat(maximum - 1)).unwrap();
        assert_eq!(sender.send("xx".into()), Err(AbortCause::Backpressure));
        drop((receiver, inflight));
        assert_eq!(pool.bytes.available_permits(), Policy::default().global_bytes);
    }
    #[tokio::test]
    async fn refusal_sends_only_the_distinct_close_code_without_oversize_payload() {
        for cause in [AbortCause::MessageTooLarge, AbortCause::Backpressure] {
            let pool = pool();
            let (sender, receiver) = pool.channel();
            sender.state.abort(cause);
            let messages = Arc::new(std::sync::Mutex::new(Vec::new()));
            let saved = messages.clone();
            let sink = futures_util::sink::unfold((), move |(), message: Message| {
                saved.lock().unwrap().push(message);
                async { Ok::<(), ()>(()) }
            });
            write(Box::pin(sink), receiver).await;
            let messages = messages.lock().unwrap();
            assert_eq!(messages.len(), 1);
            let Message::Close(Some(frame)) = &messages[0] else {
                panic!("expected close only")
            };
            assert_eq!(frame.code, cause.close().code);
            assert_eq!(frame.reason, cause.close().reason);
        }
    }
    #[test]
    fn unsafe_bootstrap_overrides_are_rejected() {
        assert!(
            Pool::new(Policy {
                message_bytes: 32,
                connection_bytes: 64,
                frames: 8,
                global_bytes: 256
            })
            .is_err()
        );
    }
}
