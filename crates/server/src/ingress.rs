//! Bounded native room input. Byte permits cover parsed-source ownership;
//! fixed control slots guarantee cleanup without an unbounded priority lane.
use crate::room::{Command, ConnId};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, Weak},
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore, mpsc};

#[derive(Clone, Copy, Debug)]
pub struct Policy {
    pub commands: usize,
    pub room_bytes: usize,
    pub global_bytes: usize,
    pub room_connections: usize,
    pub global_connections: usize,
}
impl Default for Policy {
    fn default() -> Self {
        Self {
            commands: 256,
            room_bytes: 8 << 20,
            global_bytes: 64 << 20,
            room_connections: 128,
            global_connections: 1024,
        }
    }
}
impl Policy {
    pub fn validate(self) -> Result<Self, &'static str> {
        if self.room_connections == 0
            || self.global_connections < self.room_connections
            || self
                .room_connections
                .checked_add(2)
                .is_none_or(|minimum| self.commands < minimum)
            || self.room_bytes == 0
            || self.global_bytes < self.room_bytes
            || [
                self.commands,
                self.room_bytes,
                self.global_bytes,
                self.global_connections,
            ]
            .into_iter()
            .any(|n| n > u32::MAX as usize || n > Semaphore::MAX_PERMITS)
        {
            return Err("invalid native ingress limits");
        }
        Ok(self)
    }
}
#[derive(Clone)]
pub struct Pool {
    policy: Policy,
    bytes: Arc<Semaphore>,
    connections: Arc<Semaphore>,
}
impl Pool {
    pub fn new(policy: Policy) -> Result<Self, &'static str> {
        let policy = policy.validate()?;
        Ok(Self {
            policy,
            bytes: Arc::new(Semaphore::new(policy.global_bytes)),
            connections: Arc::new(Semaphore::new(policy.global_connections)),
        })
    }
    pub fn channel(&self) -> (Sender, Receiver) {
        let (tx, rx) = mpsc::channel(self.policy.commands);
        let shutdown = tx.clone().try_reserve_owned().expect("fresh shutdown slot");
        let state = Arc::new(State {
            bytes: Arc::new(Semaphore::new(self.policy.room_bytes)),
            global: self.bytes.clone(),
            connections: Arc::new(Semaphore::new(self.policy.room_connections)),
            global_connections: self.connections.clone(),
        });
        (
            Sender {
                tx,
                state,
                shutdown: Arc::new(Mutex::new(Some(shutdown))),
            },
            Receiver {
                rx,
                active: None,
                connections: HashMap::new(),
            },
        )
    }
}
struct State {
    bytes: Arc<Semaphore>,
    global: Arc<Semaphore>,
    connections: Arc<Semaphore>,
    global_connections: Arc<Semaphore>,
}
pub(crate) struct SourcePermit {
    _bytes: [OwnedSemaphorePermit; 2],
    owner: Weak<State>,
}
struct ConnectionLease {
    _connections: [OwnedSemaphorePermit; 2],
}
struct Envelope {
    command: Command,
    source: Option<SourcePermit>,
    connection: Option<Arc<ConnectionLease>>,
}
#[derive(Clone)]
pub struct Sender {
    tx: mpsc::Sender<Envelope>,
    state: Arc<State>,
    shutdown: Arc<Mutex<Option<mpsc::OwnedPermit<Envelope>>>>,
}
pub struct SendError(pub Box<Command>);
impl std::fmt::Debug for SendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("room inbox unavailable")
    }
}
impl Sender {
    pub fn is_closed(&self) -> bool {
        self.tx.is_closed()
    }
    /// Trusted fixed in-process controls use bounded immediate admission. The
    /// native socket path must use charged send_native instead.
    pub fn send(&self, command: Command) -> Result<(), SendError> {
        if matches!(&command, Command::Shutdown { .. }) {
            if self.tx.is_closed() {
                return Err(SendError(Box::new(command)));
            }
            let Some(permit) = self.shutdown.lock().expect("shutdown slot lock").take() else {
                return Err(SendError(Box::new(command)));
            };
            drop(permit.send(Envelope {
                command,
                source: None,
                connection: None,
            }));
            return Ok(());
        }
        self.tx
            .try_send(Envelope {
                command,
                source: None,
                connection: None,
            })
            .map_err(|e| SendError(Box::new(e.into_inner().command)))
    }
    pub(crate) fn reserve_source(&self, bytes: usize) -> Option<SourcePermit> {
        if bytes > crate::limit::WS_MAX_MESSAGE || self.tx.is_closed() {
            return None;
        }
        let bytes = u32::try_from(bytes).ok()?;
        Some(SourcePermit {
            _bytes: [
                self.state.bytes.clone().try_acquire_many_owned(bytes).ok()?,
                self.state.global.clone().try_acquire_many_owned(bytes).ok()?,
            ],
            owner: Arc::downgrade(&self.state),
        })
    }
    pub(crate) async fn send_native(&self, command: Command, source: SourcePermit) -> Result<(), SendError> {
        if !source
            .owner
            .upgrade()
            .is_some_and(|owner| Arc::ptr_eq(&owner, &self.state))
        {
            return Err(SendError(Box::new(command)));
        }
        self.tx
            .send(Envelope {
                command,
                source: Some(source),
                connection: None,
            })
            .await
            .map_err(|e| SendError(Box::new(e.0.command)))
    }
    /// Reserve cleanup before upgrading a socket. The guard has no background
    /// task: cancellation/panic after Connect sends its reserved Disconnect.
    pub(crate) fn connection(&self, conn: ConnId) -> Option<ConnectionGuard> {
        let lease = Arc::new(ConnectionLease {
            _connections: [
                self.state.connections.clone().try_acquire_owned().ok()?,
                self.state.global_connections.clone().try_acquire_owned().ok()?,
            ],
        });
        let disconnect = self.tx.clone().try_reserve_owned().ok()?;
        Some(ConnectionGuard {
            sender: self.clone(),
            conn,
            lease,
            disconnect: Some(disconnect),
            connected: false,
        })
    }
}
pub(crate) struct ConnectionGuard {
    sender: Sender,
    conn: ConnId,
    lease: Arc<ConnectionLease>,
    disconnect: Option<mpsc::OwnedPermit<Envelope>>,
    connected: bool,
}
impl ConnectionGuard {
    pub async fn connect(&mut self, tx: crate::outbound::Sender) -> Result<(), SendError> {
        self.sender
            .tx
            .send(Envelope {
                command: Command::Connect { conn: self.conn, tx },
                source: None,
                connection: Some(self.lease.clone()),
            })
            .await
            .map_err(|e| SendError(Box::new(e.0.command)))?;
        // This synchronous continuation has no cancellation point after send.
        self.connected = true;
        Ok(())
    }
}
impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        if self.connected
            && let Some(permit) = self.disconnect.take()
        {
            drop(permit.send(Envelope {
                command: Command::Disconnect { conn: self.conn },
                source: None,
                connection: None,
            }));
        }
    }
}
pub struct Receiver {
    rx: mpsc::Receiver<Envelope>,
    active: Option<SourcePermit>,
    connections: HashMap<ConnId, Arc<ConnectionLease>>,
}
impl Receiver {
    fn accept(&mut self, envelope: Envelope) -> Command {
        self.active = envelope.source;
        match &envelope.command {
            Command::Connect { conn, .. } => {
                if let Some(lease) = envelope.connection {
                    self.connections.insert(*conn, lease);
                }
            }
            Command::Disconnect { conn } => {
                self.connections.remove(conn);
            }
            _ => {}
        }
        envelope.command
    }
    pub async fn recv(&mut self) -> Option<Command> {
        self.active = None;
        let envelope = self.rx.recv().await?;
        Some(self.accept(envelope))
    }
    pub fn try_recv(&mut self) -> Result<Command, mpsc::error::TryRecvError> {
        self.active = None;
        let envelope = self.rx.try_recv()?;
        Ok(self.accept(envelope))
    }
    pub fn close(&mut self) {
        self.rx.close();
    }
}
#[cfg(test)]
pub(crate) fn test_channel() -> (Sender, Receiver) {
    Pool::new(Policy::default()).unwrap().channel()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::ClientMsg;
    use tokio::sync::oneshot;
    fn pool() -> Pool {
        Pool::new(Policy {
            commands: 4,
            room_bytes: 64,
            global_bytes: 128,
            room_connections: 1,
            global_connections: 2,
        })
        .unwrap()
    }
    fn describe() -> Command {
        let (reply, _) = oneshot::channel();
        Command::Describe { reply }
    }

    #[tokio::test]
    async fn reserved_disconnect_and_shutdown_survive_a_full_ordinary_queue() {
        let pool = pool();
        let (sender, mut receiver) = pool.channel();
        let mut guard = sender.connection(1).unwrap();
        let (out, _) = crate::outbound::test_channel();
        guard.connect(out).await.unwrap();
        sender.send(describe()).unwrap();
        assert!(sender.send(describe()).is_err());
        drop(guard);
        let (done, ack) = oneshot::channel();
        sender.send(Command::Shutdown { done }).unwrap();
        assert!(matches!(receiver.recv().await, Some(Command::Connect { conn: 1, .. })));
        assert!(matches!(receiver.recv().await, Some(Command::Describe { .. })));
        assert!(matches!(receiver.recv().await, Some(Command::Disconnect { conn: 1 })));
        assert!(matches!(receiver.recv().await, Some(Command::Shutdown { .. })));
        assert!(
            ack.await.is_err(),
            "enqueuing shutdown is never a durable acknowledgement"
        );
        let (done, _) = oneshot::channel();
        assert!(sender.send(Command::Shutdown { done }).is_err());
    }

    #[tokio::test]
    async fn canceled_socket_guard_guarantees_cleanup_and_lease_until_disconnect_is_consumed() {
        let pool = pool();
        let (sender, mut receiver) = pool.channel();
        let mut guard = sender.connection(1).unwrap();
        let (ready, wait) = oneshot::channel();
        let task = tokio::spawn(async move {
            let (out, _) = crate::outbound::test_channel();
            guard.connect(out).await.unwrap();
            ready.send(()).unwrap();
            std::future::pending::<()>().await;
        });
        wait.await.unwrap();
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        assert!(sender.connection(2).is_none(), "queued Connect retains its lease");
        assert!(matches!(receiver.recv().await, Some(Command::Connect { conn: 1, .. })));
        assert!(sender.connection(2).is_none(), "admitted identity retains its lease");
        assert!(matches!(receiver.recv().await, Some(Command::Disconnect { conn: 1 })));
        assert!(sender.connection(2).is_some());
    }

    #[tokio::test]
    async fn source_is_bounded_before_parsing_and_retained_through_handling() {
        let pool = pool();
        let (sender, mut receiver) = pool.channel();
        let source = sender.reserve_source(40).unwrap();
        assert!(sender.reserve_source(25).is_none());
        sender
            .send_native(
                Command::Message {
                    conn: 1,
                    msg: ClientMsg::Hint,
                },
                source,
            )
            .await
            .unwrap();
        assert_eq!(pool.bytes.available_permits(), 88);
        assert!(matches!(receiver.recv().await, Some(Command::Message { .. })));
        assert_eq!(pool.bytes.available_permits(), 88);
        assert!(receiver.try_recv().is_err());
        assert_eq!(pool.bytes.available_permits(), 128);
    }

    #[tokio::test]
    async fn canceled_full_queue_send_drops_unsent_command_and_source_permits() {
        let pool = pool();
        let (sender, mut receiver) = pool.channel();
        for _ in 0..3 {
            sender.send(describe()).unwrap();
        }
        let source = sender.reserve_source(40).unwrap();
        assert!(
            tokio::time::timeout(
                std::time::Duration::from_millis(1),
                sender.send_native(
                    Command::Message {
                        conn: 1,
                        msg: ClientMsg::Hint
                    },
                    source
                )
            )
            .await
            .is_err()
        );
        assert_eq!(pool.bytes.available_permits(), 128);
        for _ in 0..3 {
            assert!(matches!(receiver.try_recv(), Ok(Command::Describe { .. })));
        }
        assert!(
            receiver.try_recv().is_err(),
            "canceled native command was never accepted"
        );
    }

    #[tokio::test]
    async fn global_bytes_connection_caps_and_foreign_source_ownership_are_independent() {
        let pool = pool();
        let (a, mut ar) = pool.channel();
        let (b, br) = pool.channel();
        let (c, _cr) = pool.channel();
        let first = a.connection(1).unwrap();
        let second = b.connection(2).unwrap();
        assert!(c.connection(3).is_none());
        drop(first);
        assert!(c.connection(3).is_some());
        drop(second);
        let source = a.reserve_source(40).unwrap();
        assert!(
            b.send_native(
                Command::Message {
                    conn: 1,
                    msg: ClientMsg::Hint
                },
                source
            )
            .await
            .is_err()
        );
        assert_eq!(pool.bytes.available_permits(), 128);
        let a_source = a.reserve_source(64).unwrap();
        let b_source = b.reserve_source(64).unwrap();
        assert!(c.reserve_source(1).is_none());
        a.send_native(
            Command::Message {
                conn: 1,
                msg: ClientMsg::Hint,
            },
            a_source,
        )
        .await
        .unwrap();
        b.send_native(
            Command::Message {
                conn: 1,
                msg: ClientMsg::Hint,
            },
            b_source,
        )
        .await
        .unwrap();
        drop(br);
        assert_eq!(pool.bytes.available_permits(), 64);
        assert!(matches!(ar.recv().await, Some(Command::Message { .. })));
        drop(ar);
        assert_eq!(pool.bytes.available_permits(), 128);
    }

    #[test]
    fn control_reservations_must_leave_an_ordinary_slot() {
        assert!(
            Pool::new(Policy {
                commands: 129,
                room_connections: 128,
                ..Policy::default()
            })
            .is_err()
        );
    }
}
