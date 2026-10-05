//! Bots may think on another machine. A small server can host the tables
//! while a bigger one does the thinking: the bigger one runs
//! `server --bot-worker wss://<host>/internal/bots`, which dials in (so it
//! needs no open port) and answers each move it is sent. If no worker is
//! connected, or one is slow to answer, the room thinks for itself.
//!
//! A worker opens with a hello naming its [`PROTOCOL`] and build commit;
//! the server answers with its own, or turns the worker away when the
//! protocols differ (shown on `/stats`). The worker replies to every job,
//! with the move or with an error, so a job it cannot read never leaves a
//! room waiting.
//!
//! The server pings its worker every [`HEARTBEAT`] and drops one silent for
//! [`SILENCE`]; the worker likewise redials a server silent that long. The
//! connection's state shows on `/stats`, and the server warns in its log
//! when tables think for themselves although a worker is expected. A
//! worker may also keep a file fresh while its server talks to it
//! ([`Liveness`]), for its container's health check ([`alive_within`]).

use crate::session::SessionGame;
use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use mighty::bot::Level;
use rand::SeedableRng;
use rand::rngs::StdRng;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::{Semaphore, mpsc, oneshot};

/// The version of the worker link's messages. A worker says it in its
/// hello, and a server takes only a worker that speaks its own: bump it
/// whenever the job or reply messages change shape. (Before the hello
/// existed, workers said nothing first; those count as version 1.)
pub const PROTOCOL: u32 = 2;

/// How often the server pings its worker.
pub const HEARTBEAT: Duration = Duration::from_secs(15);

/// A link with nothing heard for this long is dead.
pub const SILENCE: Duration = Duration::from_secs(45);

/// How long the server waits for a new worker's hello.
pub const HELLO_WAIT: Duration = Duration::from_secs(10);

/// How long a refused worker waits before it dials again.
const REFUSED_RETRY: Duration = Duration::from_secs(60);

/// At most one fallback warning in the log this often.
const WARN_EVERY: Duration = Duration::from_secs(300);

/// Threads one 고수 search gets on a worker; the worker takes as many moves
/// at once as its cores allow at this many each, and turns the rest away
/// (the room then thinks for itself at once).
const THREADS_PER_JOB: usize = 4;

/// The commit this binary was built from (`GIT_COMMIT` at build time; the
/// Dockerfile passes it), or `unknown`.
pub fn commit() -> &'static str {
    option_env!("GIT_COMMIT")
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .unwrap_or("unknown")
}

/// The worker connected to this server, if any.
#[derive(Default)]
pub struct RemoteBots {
    worker: Mutex<Option<Worker>>,
    next: AtomicU64,
    answered: AtomicU64,
    /// Moves the worker said it could not make.
    failed: AtomicU64,
    /// Moves a room thought itself because no worker answered.
    fallbacks: AtomicU64,
    /// Whether this server takes a worker at all (it has a bot token).
    expected: AtomicBool,
    /// When a worker was last connected or last heard, in Unix seconds.
    last_seen: AtomicU64,
    /// The last worker turned away, and why.
    refused: Mutex<Option<Refusal>>,
    warned: Mutex<Option<Instant>>,
}

struct Worker {
    /// Tells a replaced worker's connection apart from its successor's.
    conn: u64,
    tx: mpsc::UnboundedSender<String>,
    /// Each waiting room's answer: a move, or `None` when the worker could
    /// not make one.
    pending: HashMap<u64, oneshot::Sender<Option<Value>>>,
    /// When it connected, in Unix seconds.
    since: u64,
    /// The commit it was built from, as it says.
    commit: String,
}

/// A worker the server turned away.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Refusal {
    /// When, in Unix seconds.
    pub at: u64,
    /// The protocol it spoke (1: it sent no hello).
    pub protocol: u32,
    pub commit: Option<String>,
    pub reason: String,
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
    /// Moves workers said they could not make; rooms made them at once.
    pub failed: u64,
    /// Moves rooms thought themselves since, for want of a worker.
    pub fallbacks: u64,
    /// The protocol this server speaks.
    pub protocol: u32,
    /// The commit this server was built from.
    pub server_commit: String,
    /// The connected worker's commit.
    pub commit: Option<String>,
    /// The last worker turned away for speaking another protocol.
    pub refused: Option<Refusal>,
}

/// What a worker says first.
#[derive(Serialize, Deserialize)]
struct Hello {
    #[serde(rename = "type")]
    kind: String,
    protocol: u32,
    #[serde(default)]
    commit: Option<String>,
}

/// One move for a worker to think about (its `id` is read first, so even a
/// job that does not parse gets a reply).
#[derive(Deserialize)]
struct Job {
    level: Level,
    seat: usize,
    /// The bot's temperament; servers that send none mean the seat's.
    #[serde(default)]
    temper: Option<usize>,
    seed: u64,
    /// How long the room would like it to think.
    #[serde(default)]
    think_ms: Option<u64>,
    view: Value,
    legal: Value,
}

type Stream = futures_util::stream::SplitStream<WebSocket>;

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
        self.warn(&format!("{why}; tables think with in-process bots"), total);
    }

    fn warn(&self, what: &str, fallbacks: u64) {
        let mut warned = self.warned.lock().expect("warned poisoned");
        if warned.is_none_or(|t| t.elapsed() >= WARN_EVERY) {
            *warned = Some(Instant::now());
            tracing::warn!(fallbacks, "{what}");
        }
    }

    pub fn status(&self) -> WorkerStatus {
        let (since, commit) = self
            .worker
            .lock()
            .expect("worker poisoned")
            .as_ref()
            .map(|w| (w.since, w.commit.clone()))
            .unzip();
        let last_seen = self.last_seen.load(Ordering::Relaxed);
        WorkerStatus {
            expected: self.expected.load(Ordering::Relaxed),
            connected: since.is_some(),
            since,
            last_seen: (last_seen > 0).then_some(last_seen),
            answered: self.answered(),
            failed: self.failed.load(Ordering::Relaxed),
            fallbacks: self.fallbacks.load(Ordering::Relaxed),
            protocol: PROTOCOL,
            server_commit: self::commit().to_string(),
            commit,
            refused: self.refused.lock().expect("refused poisoned").clone(),
        }
    }

    fn heard(&self) {
        self.last_seen.store(crate::stats::now(), Ordering::Relaxed);
    }

    /// Asks the worker for a move, giving up after `wait`, or at once when
    /// the worker says it cannot make it or goes away.
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
        match tokio::time::timeout(wait, rx).await {
            Ok(Ok(Some(action))) => Some(action),
            // The worker said why; `answer` counted it.
            Ok(Ok(None)) => None,
            Ok(Err(_)) => {
                self.fell_back("the bot worker went away mid-move");
                None
            }
            Err(_) => {
                if let Some(worker) = self.worker.lock().expect("worker poisoned").as_mut() {
                    worker.pending.remove(&id);
                }
                self.fell_back("the bot worker did not answer in time");
                None
            }
        }
    }

    /// Waits for a new worker's hello: its commit, or why it is turned away.
    async fn hello(stream: &mut Stream) -> Result<String, Refusal> {
        let refusal = |protocol, commit, reason: &str| Refusal {
            at: crate::stats::now(),
            protocol,
            commit,
            reason: reason.to_string(),
        };
        let first = tokio::time::timeout(HELLO_WAIT, async {
            while let Some(Ok(message)) = stream.next().await {
                match message {
                    Message::Text(text) => return Some(text.to_string()),
                    Message::Close(_) => return None,
                    _ => {}
                }
            }
            None
        })
        .await;
        let text = match first {
            Ok(Some(text)) => text,
            Ok(None) => return Err(refusal(1, None, "closed before saying hello")),
            Err(_) => return Err(refusal(1, None, "sent no hello (an older worker)")),
        };
        match serde_json::from_str::<Hello>(&text) {
            Ok(hello) if hello.kind == "hello" && hello.protocol == PROTOCOL => {
                Ok(hello.commit.unwrap_or_else(|| "unknown".into()))
            }
            Ok(hello) if hello.kind == "hello" => Err(refusal(
                hello.protocol,
                hello.commit,
                &format!("speaks protocol {}, not {PROTOCOL}", hello.protocol),
            )),
            _ => Err(refusal(1, None, "its first message was not a hello (an older worker)")),
        }
    }

    /// Serves one worker connection until it closes or falls silent. A
    /// newer worker replaces an older one; one that speaks another protocol
    /// is turned away, and rooms go on thinking for themselves.
    pub async fn serve(&self, socket: WebSocket) {
        let (mut sink, mut stream) = socket.split();
        let commit = match Self::hello(&mut stream).await {
            Ok(commit) => commit,
            Err(refusal) => {
                self.warn(
                    &format!(
                        "refused a bot worker: it {} (commit {}); deploy the same build to both",
                        refusal.reason,
                        refusal.commit.as_deref().unwrap_or("unknown")
                    ),
                    self.fallbacks.load(Ordering::Relaxed),
                );
                let message = json!({
                    "type": "refused",
                    "protocol": PROTOCOL,
                    "commit": self::commit(),
                    "reason": refusal.reason,
                });
                *self.refused.lock().expect("refused poisoned") = Some(refusal);
                let _ = sink.send(Message::Text(message.to_string().into())).await;
                let _ = sink.close().await;
                return;
            }
        };
        if commit != self::commit() {
            tracing::info!(
                worker = commit,
                server = self::commit(),
                "the bot worker runs another build"
            );
        }
        let conn = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        // The welcome goes ahead of any job.
        let welcome = json!({ "type": "welcome", "protocol": PROTOCOL, "commit": self::commit() });
        let _ = tx.send(welcome.to_string());
        *self.worker.lock().expect("worker poisoned") = Some(Worker {
            conn,
            tx,
            pending: HashMap::new(),
            since: crate::stats::now(),
            commit,
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

    /// A worker's reply: `{id, action}`, or `{id, error}` when it could not
    /// make the move, so the room makes it at once instead of waiting.
    fn answer(&self, text: &str) {
        let Ok(reply) = serde_json::from_str::<Value>(text) else {
            return;
        };
        let Some(id) = reply["id"].as_u64() else { return };
        let tx = self
            .worker
            .lock()
            .expect("worker poisoned")
            .as_mut()
            .and_then(|w| w.pending.remove(&id));
        let Some(tx) = tx else { return };
        if reply.get("action").is_some_and(|a| !a.is_null()) {
            self.answered.fetch_add(1, Ordering::Relaxed);
            let _ = tx.send(Some(reply["action"].clone()));
        } else {
            self.failed.fetch_add(1, Ordering::Relaxed);
            let _ = tx.send(None);
            let why = reply["error"].as_str().unwrap_or("no reason given");
            self.fell_back(&format!("the bot worker could not make a move ({why})"));
        }
    }
}

/// How many moves a worker takes at once, and the threads each gets.
fn capacity() -> (usize, usize) {
    let cores = std::thread::available_parallelism().map_or(1, |n| n.get());
    let slots = (cores / THREADS_PER_JOB).max(1);
    (slots, (cores / slots).max(1))
}

/// What the worker says about a job: the move, or why there is none.
fn reply_for(id: u64, result: Result<Value, String>) -> String {
    match result {
        Ok(action) => json!({ "id": id, "action": action }),
        Err(error) => json!({ "id": id, "error": error }),
    }
    .to_string()
}

/// Runs a bot worker for `url` forever, reconnecting when the link drops
/// or the server falls silent. Each move gets the thinking time the room
/// asks for, at most `think`. Every job gets a reply: the move, or an
/// error (a job it cannot read, a bot that failed, every slot busy), so a
/// room never waits on a move that is not coming.
pub async fn run_worker<G: SessionGame>(url: String, token: String, think: Duration, mut alive: Liveness) {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tokio_tungstenite::tungstenite::{Message, http::HeaderValue};
    let (slots, threads) = capacity();
    let slots = Arc::new(Semaphore::new(slots));
    let hello = serde_json::to_string(&Hello {
        kind: "hello".into(),
        protocol: PROTOCOL,
        commit: Some(commit().into()),
    })
    .expect("a hello serializes");
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
        let mut retry = Duration::from_secs(5);
        match tokio_tungstenite::connect_async(request).await {
            Ok((socket, _)) => {
                tracing::info!(
                    url,
                    commit = commit(),
                    protocol = PROTOCOL,
                    "connected; thinking for the server"
                );
                let (mut sink, mut stream) = socket.split();
                let (tx, mut rx) = mpsc::unbounded_channel::<String>();
                let _ = tx.send(hello.clone());
                let writer = tokio::spawn(async move {
                    while let Some(text) = rx.recv().await {
                        if sink.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                });
                // The server pings every HEARTBEAT; reading answers the pings.
                let mut welcomed = false;
                while let Ok(Some(Ok(message))) = tokio::time::timeout(SILENCE, stream.next()).await {
                    if welcomed {
                        alive.beat();
                    }
                    let Message::Text(text) = message else { continue };
                    let value: Value = serde_json::from_str(&text).unwrap_or_default();
                    match value["type"].as_str() {
                        Some("welcome") => {
                            welcomed = true;
                            alive.beat();
                            let theirs = value["commit"].as_str().unwrap_or("unknown");
                            if theirs != commit() {
                                tracing::info!(server = theirs, worker = commit(), "the server runs another build");
                            }
                            continue;
                        }
                        Some("refused") => {
                            tracing::error!(
                                reason = value["reason"].as_str().unwrap_or(""),
                                server_protocol = value["protocol"].as_u64(),
                                server_commit = value["commit"].as_str().unwrap_or("unknown"),
                                protocol = PROTOCOL,
                                "the server refused this worker; deploy the same build to both"
                            );
                            retry = REFUSED_RETRY;
                            break;
                        }
                        _ => {}
                    }
                    let Some(id) = value["id"].as_u64() else {
                        tracing::warn!("ignored a message from the server without an id");
                        continue;
                    };
                    let job = match serde_json::from_value::<Job>(value) {
                        Ok(job) => job,
                        Err(e) => {
                            let _ = tx.send(reply_for(id, Err(format!("unreadable job: {e}"))));
                            continue;
                        }
                    };
                    let Ok(permit) = slots.clone().try_acquire_owned() else {
                        let _ = tx.send(reply_for(id, Err("busy".into())));
                        continue;
                    };
                    let tx = tx.clone();
                    tokio::task::spawn_blocking(move || {
                        let result =
                            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| solve::<G>(&job, think, threads)))
                                .unwrap_or_else(|_| Err("the bot panicked".into()));
                        drop(permit);
                        let _ = tx.send(reply_for(id, result));
                    });
                }
                writer.abort();
                tracing::warn!("lost the server; reconnecting");
            }
            Err(e) => tracing::warn!("could not reach the server: {e}"),
        }
        tokio::time::sleep(retry).await;
    }
}

/// How often at most the worker rewrites its liveness file.
const ALIVE_EVERY: Duration = Duration::from_secs(5);

/// A file the worker keeps fresh, with the time in Unix seconds, while the
/// server it thinks for talks to it: from the server's welcome on, at every
/// message (the server pings every [`HEARTBEAT`]). Gone stale, the worker
/// is not thinking for anyone: lost, refused or stuck.
pub struct Liveness {
    path: Option<PathBuf>,
    written: Option<Instant>,
}

impl Liveness {
    pub fn new(path: Option<PathBuf>) -> Liveness {
        Liveness { path, written: None }
    }

    fn beat(&mut self) {
        let Some(path) = &self.path else { return };
        if self.written.is_some_and(|t| t.elapsed() < ALIVE_EVERY) {
            return;
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        // Written whole, then moved into place, so a reader never sees half.
        let partial = path.with_extension("partial");
        match std::fs::write(&partial, now.to_string()).and_then(|()| std::fs::rename(&partial, path)) {
            Ok(()) => self.written = Some(Instant::now()),
            Err(e) => tracing::warn!(path = %path.display(), "could not write the liveness file: {e}"),
        }
    }
}

/// Whether a worker's liveness file ([`Liveness`]) was written within
/// `fresh`: the worker's health check.
pub fn alive_within(path: &Path, fresh: Duration) -> bool {
    let Ok(text) = std::fs::read_to_string(path) else {
        return false;
    };
    let Ok(then) = text.trim().parse::<u64>() else {
        return false;
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    now.saturating_sub(then) <= fresh.as_secs()
}

fn solve<G: SessionGame>(job: &Job, most: Duration, threads: usize) -> Result<Value, String> {
    let think = job.think_ms.map_or(most, |ms| Duration::from_millis(ms).min(most));
    let view: G::View = serde_json::from_value(job.view.clone()).map_err(|e| format!("unreadable view: {e}"))?;
    let legal: Vec<G::Action> =
        serde_json::from_value(job.legal.clone()).map_err(|e| format!("unreadable legal moves: {e}"))?;
    if legal.is_empty() {
        return Err("no legal moves".into());
    }
    let action = G::bot(job.level, job.temper.unwrap_or(job.seat), think, threads).act(
        &view,
        &legal,
        &mut StdRng::seed_from_u64(job.seed),
    );
    serde_json::to_value(action).map_err(|e| e.to_string())
}
