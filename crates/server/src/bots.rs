//! Bots may think on another machine. A small server can host the tables
//! while a bigger one does the thinking: the bigger one runs
//! `server --bot-worker wss://<host>/internal/bots`, which dials in (so it
//! needs no open port) and answers each move it is sent. If no worker is
//! connected, or one is slow to answer, the room thinks for itself.
//!
//! The server pings its worker every [`HEARTBEAT`] and drops one silent for
//! [`SILENCE`]; the worker likewise redials a server silent that long. The
//! connection's state shows on `/stats`, and the server warns in its log
//! when tables think for themselves although a worker is expected.

use crate::session::{BotLevel, SessionGame};
use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use rand::SeedableRng;
use rand::rngs::StdRng;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, oneshot};

/// How often the server pings its worker.
pub const HEARTBEAT: Duration = Duration::from_secs(15);

/// A link with nothing heard for this long is dead.
pub const SILENCE: Duration = Duration::from_secs(45);

/// At most one fallback warning in the log this often.
const WARN_EVERY: Duration = Duration::from_secs(300);

/// The worker connected to this server, if any.
#[derive(Default)]
pub struct RemoteBots {
    worker: Mutex<Option<Worker>>,
    next: AtomicU64,
    answered: AtomicU64,
    /// Moves a room thought itself because no worker answered.
    fallbacks: AtomicU64,
    /// Whether this server takes a worker at all (it has a bot token).
    expected: AtomicBool,
    /// When a worker was last connected or last heard, in Unix seconds.
    last_seen: AtomicU64,
    warned: Mutex<Option<Instant>>,
}

struct Worker {
    /// Tells a replaced worker's connection apart from its successor's.
    conn: u64,
    tx: mpsc::UnboundedSender<String>,
    pending: HashMap<u64, oneshot::Sender<Value>>,
    /// When it connected, in Unix seconds.
    since: u64,
}

/// The worker link, for `/stats`.
#[derive(Debug, Clone, Serialize)]
pub struct WorkerStatus {
    /// Whether this server takes a worker (it has a bot token).
    pub expected: bool,
    pub connected: bool,
    /// When the current worker connected, in Unix seconds.
    pub since: Option<u64>,
    /// When a worker was last heard, in Unix seconds.
    pub last_seen: Option<u64>,
    /// Moves workers sent back since the server started.
    pub answered: u64,
    /// Moves rooms thought themselves since, for want of a worker.
    pub fallbacks: u64,
}

/// One move for a worker to think about.
#[derive(Deserialize)]
struct Job {
    id: u64,
    level: BotLevel,
    seat: usize,
    seed: u64,
    /// How long the room would like it to think.
    #[serde(default)]
    think_ms: Option<u64>,
    view: Value,
    legal: Value,
}

impl RemoteBots {
    /// Notes that a worker should be connected, so its absence is warned about.
    pub fn expect_worker(&self) {
        self.expected.store(true, Ordering::Relaxed);
    }

    /// How many moves workers have sent back.
    pub fn answered(&self) -> u64 {
        self.answered.load(Ordering::Relaxed)
    }

    pub fn connected(&self) -> bool {
        self.worker.lock().expect("worker poisoned").is_some()
    }

    /// Whether a worker can take a move now. When one is expected but
    /// absent, counts the move as thought here and warns, now and then.
    pub fn available(&self) -> bool {
        let connected = self.connected();
        if !connected && self.expected.load(Ordering::Relaxed) {
            self.fell_back("no bot worker is connected");
        }
        connected
    }

    fn fell_back(&self, why: &str) {
        let total = self.fallbacks.fetch_add(1, Ordering::Relaxed) + 1;
        let mut warned = self.warned.lock().expect("warned poisoned");
        if warned.is_none_or(|t| t.elapsed() >= WARN_EVERY) {
            *warned = Some(Instant::now());
            tracing::warn!(fallbacks = total, "{why}; tables think with in-process bots");
        }
    }

    pub fn status(&self) -> WorkerStatus {
        let since = self.worker.lock().expect("worker poisoned").as_ref().map(|w| w.since);
        let last_seen = self.last_seen.load(Ordering::Relaxed);
        WorkerStatus {
            expected: self.expected.load(Ordering::Relaxed),
            connected: since.is_some(),
            since,
            last_seen: (last_seen > 0).then_some(last_seen),
            answered: self.answered(),
            fallbacks: self.fallbacks.load(Ordering::Relaxed),
        }
    }

    fn heard(&self) {
        self.last_seen.store(crate::stats::now(), Ordering::Relaxed);
    }

    /// Asks the worker for a move, giving up after `wait`.
    pub async fn ask(&self, mut job: Value, wait: Duration) -> Option<Value> {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        {
            let mut worker = self.worker.lock().expect("worker poisoned");
            let worker = worker.as_mut()?;
            job["id"] = json!(id);
            worker.tx.send(job.to_string()).ok()?;
            worker.pending.insert(id, tx);
        }
        let answer = tokio::time::timeout(wait, rx).await.ok().and_then(Result::ok);
        if answer.is_none() {
            if let Some(worker) = self.worker.lock().expect("worker poisoned").as_mut() {
                worker.pending.remove(&id);
            }
            self.fell_back("the bot worker did not answer in time");
        }
        answer
    }

    /// Serves one worker connection until it closes or falls silent. A
    /// newer worker replaces an older one.
    pub async fn serve(&self, socket: WebSocket) {
        let conn = self.next.fetch_add(1, Ordering::Relaxed);
        let (mut sink, mut stream) = socket.split();
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        *self.worker.lock().expect("worker poisoned") = Some(Worker {
            conn,
            tx,
            pending: HashMap::new(),
            since: crate::stats::now(),
        });
        self.heard();
        tracing::info!("bot worker connected");
        let mut writer = tokio::spawn(async move {
            let mut beat = tokio::time::interval(HEARTBEAT);
            loop {
                let message = tokio::select! {
                    text = rx.recv() => match text {
                        Some(text) => Message::Text(text.into()),
                        None => break,
                    },
                    _ = beat.tick() => Message::Ping(Default::default()),
                };
                if sink.send(message).await.is_err() {
                    break;
                }
            }
        });
        loop {
            tokio::select! {
                incoming = tokio::time::timeout(SILENCE, stream.next()) => match incoming {
                    Err(_) => {
                        tracing::warn!("bot worker went silent; dropping it");
                        break;
                    }
                    Ok(Some(Ok(Message::Text(text)))) => {
                        self.heard();
                        self.answer(&text);
                    }
                    Ok(Some(Ok(Message::Close(_)) | Err(_)) | None) => break,
                    // Pongs, mostly: the worker is alive.
                    Ok(Some(Ok(_))) => self.heard(),
                },
                _ = &mut writer => break,
            }
        }
        writer.abort();
        let mut worker = self.worker.lock().expect("worker poisoned");
        if worker.as_ref().is_some_and(|w| w.conn == conn) {
            *worker = None;
            tracing::warn!("bot worker disconnected; rooms think for themselves");
        }
    }

    fn answer(&self, text: &str) {
        let Ok(reply) = serde_json::from_str::<Value>(text) else {
            return;
        };
        let Some(id) = reply["id"].as_u64() else { return };
        let mut worker = self.worker.lock().expect("worker poisoned");
        if let Some(tx) = worker.as_mut().and_then(|w| w.pending.remove(&id)) {
            self.answered.fetch_add(1, Ordering::Relaxed);
            let _ = tx.send(reply["action"].clone());
        }
    }
}

/// Runs a bot worker for `url` forever, reconnecting when the link drops
/// or the server falls silent. Each move gets the thinking time the room
/// asks for, at most `think`.
pub async fn run_worker<G: SessionGame>(url: String, token: String, think: Duration) {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tokio_tungstenite::tungstenite::{Message, http::HeaderValue};
    loop {
        let mut request = match url.as_str().into_client_request() {
            Ok(request) => request,
            Err(e) => {
                tracing::error!("bad bot worker url: {e}");
                return;
            }
        };
        let Ok(auth) = HeaderValue::from_str(&format!("Bearer {token}")) else {
            tracing::error!("the bot token is not a valid header value");
            return;
        };
        request.headers_mut().insert("authorization", auth);
        match tokio_tungstenite::connect_async(request).await {
            Ok((socket, _)) => {
                tracing::info!(url, "connected; thinking for the server");
                let (mut sink, mut stream) = socket.split();
                let (tx, mut rx) = mpsc::unbounded_channel::<String>();
                let writer = tokio::spawn(async move {
                    while let Some(text) = rx.recv().await {
                        if sink.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                });
                // The server pings every HEARTBEAT; reading answers the pings.
                while let Ok(Some(Ok(message))) = tokio::time::timeout(SILENCE, stream.next()).await {
                    let Message::Text(text) = message else { continue };
                    let Ok(job) = serde_json::from_str::<Job>(&text) else {
                        continue;
                    };
                    let tx = tx.clone();
                    tokio::task::spawn_blocking(move || {
                        if let Some(action) = solve::<G>(&job, think) {
                            let _ = tx.send(json!({ "id": job.id, "action": action }).to_string());
                        }
                    });
                }
                writer.abort();
                tracing::warn!("lost the server; reconnecting");
            }
            Err(e) => tracing::warn!("could not reach the server: {e}"),
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}

fn solve<G: SessionGame>(job: &Job, most: Duration) -> Option<Value> {
    let think = job.think_ms.map_or(most, |ms| Duration::from_millis(ms).min(most));
    let view: G::View = serde_json::from_value(job.view.clone()).ok()?;
    let legal: Vec<G::Action> = serde_json::from_value(job.legal.clone()).ok()?;
    if legal.is_empty() {
        return None;
    }
    let threads = std::thread::available_parallelism().map_or(1, |n| n.get());
    let action = G::bot(job.level, job.seat, think, threads).act(&view, &legal, &mut StdRng::seed_from_u64(job.seed));
    serde_json::to_value(action).ok()
}
