//! HTTP and WebSocket front end. Rooms live in memory; each runs as its own
//! task (see [`room`]).

pub mod room;
pub mod session;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use mighty::Mighty;
use mighty::rules::Preset;
use rand::Rng;
use room::{ClientMsg, Command, ConnId, Room};
use serde::Deserialize;
use serde_json::json;
use session::{MightySettings, SessionGame};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc::{self, UnboundedSender};
use tower_http::services::{ServeDir, ServeFile};

type Registry = Arc<Mutex<HashMap<String, UnboundedSender<Command>>>>;

#[derive(Clone)]
pub struct AppState {
    rooms: Registry,
    next_conn: Arc<AtomicU64>,
    bot_delay: Duration,
    max_rooms: usize,
    /// A room with nobody connected for this long closes.
    idle: Duration,
    /// Where rooms are saved so they survive a restart, if anywhere.
    data: Option<PathBuf>,
}

impl AppState {
    pub fn new(bot_delay: Duration) -> AppState {
        AppState {
            rooms: Arc::default(),
            next_conn: Arc::default(),
            bot_delay,
            max_rooms: 500,
            idle: Duration::from_secs(30 * 60),
            data: None,
        }
    }

    /// Saves every room under `dir` as it changes; see [`AppState::restore_rooms`].
    pub fn with_data(self, dir: PathBuf) -> AppState {
        AppState {
            data: Some(dir),
            ..self
        }
    }

    /// Reopens the rooms saved under the data directory, returning how many.
    /// A file that no longer loads (say, after an incompatible rules change)
    /// is set aside as `.bad` rather than deleted.
    pub fn restore_rooms(&self) -> std::io::Result<usize> {
        let Some(dir) = &self.data else { return Ok(0) };
        std::fs::create_dir_all(dir)?;
        let mut restored = 0;
        for entry in std::fs::read_dir(dir)? {
            let path = entry?.path();
            if path.extension().is_none_or(|e| e != "json") {
                continue;
            }
            let loaded = std::fs::read_to_string(&path)
                .map_err(|e| e.to_string())
                .and_then(|text| serde_json::from_str(&text).map_err(|e| e.to_string()))
                .and_then(|snapshot| Room::<Mighty>::restore(snapshot, self.bot_delay));
            match loaded {
                Ok(room) => {
                    let id = room.id().to_string();
                    let mut rooms = self.rooms.lock().expect("room registry poisoned");
                    self.spawn_room(&mut rooms, id, room);
                    restored += 1;
                }
                Err(e) => {
                    tracing::warn!(file = %path.display(), "could not restore room: {e}");
                    let _ = std::fs::rename(&path, path.with_extension("bad"));
                }
            }
        }
        Ok(restored)
    }

    /// At most `max_rooms` open at once; each closes after `idle` with nobody connected.
    pub fn with_limits(self, max_rooms: usize, idle: Duration) -> AppState {
        AppState {
            max_rooms,
            idle,
            ..self
        }
    }

    /// Opens a room and returns its id, which is also its share link, or
    /// `None` when the server already has as many rooms as it allows.
    pub fn create_room<G: SessionGame>(&self, settings: G::Settings) -> Option<String> {
        const ALPHABET: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";
        let mut rooms = self.rooms.lock().expect("room registry poisoned");
        if rooms.len() >= self.max_rooms {
            return None;
        }
        let mut rng = rand::rng();
        let id = loop {
            let id: String = (0..6)
                .map(|_| char::from(ALPHABET[rng.random_range(0..ALPHABET.len())]))
                .collect();
            if !rooms.contains_key(&id) {
                break id;
            }
        };
        let room = Room::<G>::new(id.clone(), settings, self.bot_delay);
        self.spawn_room(&mut rooms, id.clone(), room);
        Some(id)
    }

    fn spawn_room<G: SessionGame>(
        &self,
        rooms: &mut HashMap<String, UnboundedSender<Command>>,
        id: String,
        room: Room<G>,
    ) {
        let (tx, rx) = mpsc::unbounded_channel();
        let save = self.data.as_ref().map(|dir| dir.join(format!("{id}.json")));
        let (registry, key, idle, me) = (self.rooms.clone(), id.clone(), self.idle, tx.downgrade());
        tokio::spawn(async move {
            room.run(me, rx, idle, save).await;
            registry.lock().expect("room registry poisoned").remove(&key);
            tracing::info!(room = key, "closed idle room");
        });
        rooms.insert(id, tx);
    }

    fn room(&self, id: &str) -> Option<UnboundedSender<Command>> {
        self.rooms.lock().expect("room registry poisoned").get(id).cloned()
    }
}

/// The API under `/api`, plus the built web client from `web_dir` if given.
pub fn router(state: AppState, web_dir: Option<PathBuf>) -> Router {
    let api = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/api/presets", get(presets))
        .route("/api/presets/{id}", get(preset_rules))
        .route("/api/rooms", post(create_room))
        .route("/api/rooms/{id}", get(room_info))
        .route("/api/rooms/{id}/ws", get(connect))
        .with_state(state);
    match web_dir {
        // Unknown paths such as /r/abc123 get the app, which routes on the client.
        Some(dir) => api.fallback_service(ServeDir::new(&dir).fallback(ServeFile::new(dir.join("index.html")))),
        None => api,
    }
}

async fn presets() -> Json<Vec<&'static str>> {
    Json(Preset::ALL.iter().map(|p| p.name()).collect())
}

/// The full rules of a preset, for the rulebook.
async fn preset_rules(Path(id): Path<String>) -> Response {
    match id.parse::<Preset>() {
        Ok(preset) => Json(preset.rules()).into_response(),
        Err(e) => (StatusCode::NOT_FOUND, e).into_response(),
    }
}

#[derive(Deserialize, Default)]
struct CreateRoom {
    #[serde(default)]
    preset: Option<Preset>,
}

async fn create_room(State(app): State<AppState>, body: Option<Json<CreateRoom>>) -> Response {
    let preset = body.and_then(|Json(b)| b.preset).unwrap_or(Preset::Gshs);
    match app.create_room::<Mighty>(MightySettings { preset, rules: None }) {
        Some(id) => Json(json!({ "id": id })).into_response(),
        None => (StatusCode::SERVICE_UNAVAILABLE, "too many tables are open").into_response(),
    }
}

async fn room_info(State(app): State<AppState>, Path(id): Path<String>) -> Response {
    match app.room(&id) {
        Some(_) => Json(json!({ "id": id, "game": Mighty::NAME })).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn connect(State(app): State<AppState>, Path(id): Path<String>, ws: WebSocketUpgrade) -> Response {
    let Some(room) = app.room(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let conn = app.next_conn.fetch_add(1, Ordering::Relaxed);
    ws.on_upgrade(move |socket| serve_connection(socket, room, conn))
}

async fn serve_connection(socket: WebSocket, room: UnboundedSender<Command>, conn: ConnId) {
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let errors = tx.clone();
    if room.send(Command::Connect { conn, tx }).is_err() {
        return;
    }
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
                Some(Ok(Message::Text(text))) => match serde_json::from_str::<ClientMsg>(&text) {
                    Ok(msg) => {
                        let _ = room.send(Command::Message { conn, msg });
                    }
                    Err(e) => {
                        let _ = errors.send(json!({ "type": "error", "message": format!("bad message: {e}") }).to_string());
                    }
                },
                Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                Some(Ok(_)) => {}
            },
            _ = &mut writer => break,
        }
    }
    let _ = room.send(Command::Disconnect { conn });
    writer.abort();
}
