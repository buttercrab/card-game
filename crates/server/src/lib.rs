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

#[derive(Clone)]
pub struct AppState {
    rooms: Arc<Mutex<HashMap<String, UnboundedSender<Command>>>>,
    next_conn: Arc<AtomicU64>,
    bot_delay: Duration,
}

impl AppState {
    pub fn new(bot_delay: Duration) -> AppState {
        AppState {
            rooms: Arc::default(),
            next_conn: Arc::default(),
            bot_delay,
        }
    }

    /// Opens a room and returns its id, which is also its share link.
    pub fn create_room<G: SessionGame>(&self, settings: G::Settings) -> String {
        const ALPHABET: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";
        let mut rooms = self.rooms.lock().expect("room registry poisoned");
        let mut rng = rand::rng();
        let id = loop {
            let id: String = (0..6)
                .map(|_| char::from(ALPHABET[rng.random_range(0..ALPHABET.len())]))
                .collect();
            if !rooms.contains_key(&id) {
                break id;
            }
        };
        let (tx, rx) = mpsc::unbounded_channel();
        let room = Room::<G>::new(id.clone(), settings, self.bot_delay);
        tokio::spawn(room.run(tx.downgrade(), rx));
        rooms.insert(id.clone(), tx);
        id
    }

    fn room(&self, id: &str) -> Option<UnboundedSender<Command>> {
        self.rooms.lock().expect("room registry poisoned").get(id).cloned()
    }
}

/// The API under `/api`, plus the built web client from `web_dir` if given.
pub fn router(state: AppState, web_dir: Option<PathBuf>) -> Router {
    let api = Router::new()
        .route("/api/presets", get(presets))
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

#[derive(Deserialize, Default)]
struct CreateRoom {
    #[serde(default)]
    preset: Option<Preset>,
}

async fn create_room(State(app): State<AppState>, body: Option<Json<CreateRoom>>) -> Json<serde_json::Value> {
    let preset = body.and_then(|Json(b)| b.preset).unwrap_or(Preset::Gshs);
    let id = app.create_room::<Mighty>(MightySettings { preset });
    Json(json!({ "id": id }))
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
