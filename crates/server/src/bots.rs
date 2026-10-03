//! Bots may think on another machine. A small server can host the tables
//! while a bigger one does the thinking: the bigger one runs
//! `server --bot-worker wss://<host>/internal/bots`, which dials in (so it
//! needs no open port) and answers each move it is sent. If no worker is
//! connected, or one is slow to answer, the room thinks for itself.

use crate::session::{BotLevel, SessionGame};
use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use rand::SeedableRng;
use rand::rngs::StdRng;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};

/// The worker connected to this server, if any.
#[derive(Default)]
pub struct RemoteBots {
    worker: Mutex<Option<Worker>>,
    next: AtomicU64,
    answered: AtomicU64,
}

struct Worker {
    /// Tells a replaced worker's connection apart from its successor's.
    conn: u64,
    tx: mpsc::UnboundedSender<String>,
    pending: HashMap<u64, oneshot::Sender<Value>>,
}

/// One move for a worker to think about.
#[derive(Deserialize)]
struct Job {
    id: u64,
    level: BotLevel,
    seat: usize,
    seed: u64,
    view: Value,
    legal: Value,
}

impl RemoteBots {
    /// How many moves workers have sent back.
    pub fn answered(&self) -> u64 {
        self.answered.load(Ordering::Relaxed)
    }

    pub fn connected(&self) -> bool {
        self.worker.lock().expect("worker poisoned").is_some()
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
        if answer.is_none()
            && let Some(worker) = self.worker.lock().expect("worker poisoned").as_mut()
        {
            worker.pending.remove(&id);
        }
        answer
    }

    /// Serves one worker connection until it closes. A newer worker
    /// replaces an older one.
    pub async fn serve(&self, socket: WebSocket) {
        let conn = self.next.fetch_add(1, Ordering::Relaxed);
        let (mut sink, mut stream) = socket.split();
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        *self.worker.lock().expect("worker poisoned") = Some(Worker {
            conn,
            tx,
            pending: HashMap::new(),
        });
        tracing::info!("bot worker connected");
        let mut writer = tokio::spawn(async move {
            while let Some(text) = rx.recv().await {
                if sink.send(Message::Text(text.into())).await.is_err() {
                    break;
                }
            }
        });
        loop {
            tokio::select! {
                incoming = stream.next() => match incoming {
                    Some(Ok(Message::Text(text))) => self.answer(&text),
                    Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                    Some(Ok(_)) => {}
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

/// Runs a bot worker for `url` forever, reconnecting when the link drops.
/// Each move gets about `think` of thinking.
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
                while let Some(Ok(message)) = stream.next().await {
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

fn solve<G: SessionGame>(job: &Job, think: Duration) -> Option<Value> {
    let view: G::View = serde_json::from_value(job.view.clone()).ok()?;
    let legal: Vec<G::Action> = serde_json::from_value(job.legal.clone()).ok()?;
    if legal.is_empty() {
        return None;
    }
    let action = G::bot(job.level, job.seat, think).act(&view, &legal, &mut StdRng::seed_from_u64(job.seed));
    serde_json::to_value(action).ok()
}
