//! Shared native background cognition. Waiting notifications own no CPU grant
//! or private game view. Admission is bounded retry, not FIFO scheduling.
use std::sync::Arc;
use tokio::sync::{Notify, OwnedSemaphorePermit, Semaphore};
pub const ROOM_JOBS: usize = 16;
pub const INTERNAL_MESSAGES: usize = 32;
#[derive(Clone)]
pub struct Budget {
    inner: Arc<Inner>,
}
struct Inner {
    slots: Arc<Semaphore>,
    released: Arc<Notify>,
}
impl Budget {
    pub fn new(limit: usize) -> Self {
        assert!(
            limit > 0 && limit <= Semaphore::MAX_PERMITS,
            "invalid native cognition limit"
        );
        Self {
            inner: Arc::new(Inner {
                slots: Arc::new(Semaphore::new(limit)),
                released: Arc::new(Notify::new()),
            }),
        }
    }
    pub(crate) fn try_acquire(&self) -> Option<Permit> {
        Some(Permit {
            slot: Some(self.inner.slots.clone().try_acquire_owned().ok()?),
            owner: self.inner.clone(),
        })
    }
    pub(crate) fn notification(&self) -> std::pin::Pin<Box<tokio::sync::futures::OwnedNotified>> {
        let mut notified = Box::pin(self.inner.released.clone().notified_owned());
        // Subscribe BEFORE the caller retries acquisition, closing the release
        // race between observing saturation and installing a lightweight wait.
        notified.as_mut().enable();
        notified
    }
}
impl Default for Budget {
    fn default() -> Self {
        Self::new(64)
    }
}
pub(crate) struct Permit {
    slot: Option<OwnedSemaphorePermit>,
    owner: Arc<Inner>,
}
impl Drop for Permit {
    fn drop(&mut self) {
        drop(self.slot.take());
        self.owner.released.notify_waiters();
    }
}
pub(crate) struct TaskGuard(tokio::task::AbortHandle);
impl TaskGuard {
    pub fn new(task: &tokio::task::JoinHandle<()>) -> Self {
        Self(task.abort_handle())
    }
    pub fn finished(&self) -> bool {
        self.0.is_finished()
    }
}
impl Drop for TaskGuard {
    fn drop(&mut self) {
        self.0.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn enabled_notification_covers_release_before_wait_and_owns_no_grant() {
        let budget = Budget::new(1);
        let running = budget.try_acquire().unwrap();
        let notice = budget.notification();
        assert!(budget.try_acquire().is_none());
        drop(running);
        notice.await;
        let running = budget.try_acquire().unwrap();
        let notice = budget.notification();
        drop(running);
        let competitor = budget.try_acquire().unwrap();
        notice.await;
        assert!(budget.try_acquire().is_none());
        let retry = budget.notification();
        drop(competitor);
        retry.await;
        assert!(budget.try_acquire().is_some());
    }
    #[tokio::test]
    async fn blocking_cognition_retains_permit_after_async_owner_is_cancelled() {
        let budget = Budget::new(1);
        let permit = budget.try_acquire().unwrap();
        let (started, ready) = tokio::sync::oneshot::channel();
        let (finish, wait) = std::sync::mpsc::channel();
        let task = tokio::spawn(async move {
            tokio::task::spawn_blocking(move || {
                let _permit = permit;
                started.send(()).unwrap();
                wait.recv().unwrap();
            })
            .await
            .unwrap();
        });
        ready.await.unwrap();
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        assert!(budget.try_acquire().is_none());
        let notice = budget.notification();
        finish.send(()).unwrap();
        notice.await;
        assert!(budget.try_acquire().is_some());
    }
    #[tokio::test]
    async fn aborting_lightweight_waiter_after_notification_retains_no_cpu() {
        let budget = Budget::new(1);
        let running = budget.try_acquire().unwrap();
        let notice = budget.notification();
        let task = tokio::spawn(async move {
            notice.await;
            std::future::pending::<()>().await;
        });
        let guard = TaskGuard::new(&task);
        drop(running);
        drop(guard);
        assert!(task.await.unwrap_err().is_cancelled());
        assert!(budget.try_acquire().is_some());
    }
}
