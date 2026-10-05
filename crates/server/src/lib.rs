//! HTTP and WebSocket front end. Rooms live in memory; each runs as its own
//! task (see [`room`]).

pub mod bots;
pub mod catalog;
pub mod codegen;
pub mod config;
pub mod dashboard;
pub mod errors;
pub mod limit;
pub mod protocol;
pub mod room;
pub mod session;
pub mod site;
pub mod stats;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
pub use config::{Config, IDLE_MINUTES};
use futures_util::{SinkExt, StreamExt};
use limit::{ClientIp, Limits, too_many};
use mighty::Mighty;
use mighty::rules::{Preset, Rules};
use protocol::ClientMsg;
use protocol::{CreateRoom, CreatedRoom, ErrorCode, ServerError};
use rand::Rng;
use room::{BotConfig, Command, ConnId, Room, RoomEnv};
use serde::Deserialize;
use serde_json::{Value, json};
use session::{MightySettings, SessionGame};
use stats::{Event, Stats};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc::{self, UnboundedSender};

/// The open tables, by id.
#[derive(Default)]
struct Rooms {
    open: Mutex<HashMap<String, UnboundedSender<Command>>>,
    /// The next table connection's id.
    next_conn: AtomicU64,
}

impl Rooms {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, UnboundedSender<Command>>> {
        self.open.lock().expect("room registry poisoned")
    }
}

/// What every request handler shares: the server's settings, its tables,
/// what the tables share ([`RoomEnv`]), the rate limits and the stats.
#[derive(Clone)]
pub struct AppState {
    config: Arc<Config>,
    rooms: Arc<Rooms>,
    env: Arc<RoomEnv>,
    limits: Arc<Limits>,
    stats: Arc<Stats>,
}

impl AppState {
    /// A server as `config` sets it up. With a data directory, the stats
    /// log is kept there (see [`AppState::restore_rooms`] for the tables).
    pub fn new(config: Config) -> AppState {
        let stats = match &config.data {
            Some(dir) => Stats::open(dir, config.stats_salt.clone()).unwrap_or_else(|e| {
                tracing::error!(dir = %dir.display(), "could not open the stats log, keeping it in memory: {e}");
                Stats::in_memory()
            }),
            None => Stats::in_memory(),
        };
        let stats = Arc::new(stats);
        let remote = Arc::new(bots::RemoteBots::default());
        // From now on, tables thinking for themselves are warned about.
        if config.bot_token.is_some() {
            remote.expect_worker();
        }
        let env = RoomEnv {
            bots: BotConfig {
                delay: config.bot_delay(),
                think_cap: config.bot_think(),
            },
            idle: config.idle(),
            turn_second: Duration::from_secs(1),
            remote,
            stats: stats.clone(),
            data: config.data.clone(),
        };
        AppState {
            config: Arc::new(config),
            rooms: Arc::default(),
            env: Arc::new(env),
            limits: Arc::default(),
            stats,
        }
    }

    pub fn config(&self) -> &Config {
        &self.config
    }

    /// Makes a turn limit's seconds last `second` instead, so a test need
    /// not wait out real turns.
    pub fn with_turn_second(self, second: Duration) -> AppState {
        let env = RoomEnv {
            turn_second: second,
            ..(*self.env).clone()
        };
        AppState {
            env: Arc::new(env),
            ..self
        }
    }

    /// The stats log, for recording from outside a request.
    pub fn stats(&self) -> Arc<Stats> {
        self.stats.clone()
    }

    /// The connection to a bot worker, if one dials in.
    pub fn remote_bots(&self) -> Arc<bots::RemoteBots> {
        self.env.remote.clone()
    }

    /// Reopens the rooms saved under the data directory, returning how many.
    /// A file that no longer loads (say, after an incompatible rules change)
    /// is set aside as `.bad` rather than deleted.
    pub fn restore_rooms(&self) -> std::io::Result<usize> {
        let Some(dir) = &self.config.data else { return Ok(0) };
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
                .and_then(|snapshot| Room::<Mighty>::restore(snapshot, self.env.clone()));
            match loaded {
                Ok(room) => {
                    let id = room.id().to_string();
                    let mut rooms = self.rooms.lock();
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

    /// Asks every room to save itself and end, keeping its file for the next
    /// server to restore (see [`AppState::restore_rooms`]); returns how many
    /// did within `wait`. For a restart: connections drop, and clients
    /// reconnect to the next server with their seat tokens.
    pub async fn shutdown(&self, wait: Duration) -> usize {
        let rooms: Vec<_> = self.rooms.lock().values().cloned().collect();
        let mut pending = Vec::new();
        for room in rooms {
            let (done, rx) = tokio::sync::oneshot::channel();
            if room.send(Command::Shutdown { done }).is_ok() {
                pending.push(rx);
            }
        }
        let all = futures_util::future::join_all(pending);
        match tokio::time::timeout(wait, all).await {
            Ok(results) => results.into_iter().filter(Result::is_ok).count(),
            Err(_) => 0,
        }
    }

    /// How many rooms are open now.
    pub fn open_rooms(&self) -> usize {
        self.rooms.lock().len()
    }

    /// The server's live state, for `/stats`.
    pub fn server_status(&self) -> dashboard::ServerStatus {
        dashboard::ServerStatus {
            rooms: self.open_rooms(),
            max_rooms: self.config.max_rooms,
            worker: self.env.remote.status(),
        }
    }

    /// Opens a room and returns its id, which is also its share link, or
    /// `None` when the server already has as many rooms as it allows.
    pub fn create_room<G: SessionGame>(&self, mut settings: G::Settings) -> Option<String> {
        const ALPHABET: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";
        G::freeze(&mut settings);
        let mut rooms = self.rooms.lock();
        if rooms.len() >= self.config.max_rooms {
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
        self.stats.record(Event::TableCreated {
            table: id.clone(),
            preset: G::preset_id(&settings).to_string(),
        });
        let room = Room::<G>::new(id.clone(), settings, self.env.clone());
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
        let (registry, key) = (self.rooms.clone(), id.clone());
        tokio::spawn(async move {
            room.run(rx).await;
            registry.lock().remove(&key);
            tracing::info!(room = key, "room closed");
        });
        rooms.insert(id, tx);
    }

    fn room(&self, id: &str) -> Option<UnboundedSender<Command>> {
        self.rooms.lock().get(id).cloned()
    }
}

/// Refuses a body over `max` bytes. One whose declared length is over is
/// refused before any of it is read, so a client that waits for `100
/// Continue` never sends it.
fn body_limit(max: usize) -> tower_http::limit::RequestBodyLimitLayer {
    tower_http::limit::RequestBodyLimitLayer::new(max)
}

/// The API under `/api`, plus the built web client from [`Config::web`] if given.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/version", get(version))
        .route("/api/presets", get(presets))
        .route("/api/presets/{id}", get(preset_rules))
        .route("/api/rooms", post(create_room).layer(body_limit(16 * 1024)))
        .route("/api/rules/examples", post(rule_examples).layer(body_limit(16 * 1024)))
        .route("/api/rooms/{id}", get(room_info))
        .route("/api/rooms/{id}/ws", get(connect))
        .route("/api/reports", post(report).layer(body_limit(REPORT_BODY)))
        .route("/api/errors", post(errors::client_error).layer(body_limit(32 * 1024)))
        .route("/api/stats", get(dashboard::stats_json))
        .route("/stats", get(dashboard::stats_page))
        .route("/stats/reports/{file}", get(dashboard::report_file))
        .route("/robots.txt", get(site::robots_txt))
        .route("/sitemap.xml", get(site::sitemap_xml))
        .route("/internal/bots", get(bot_worker))
        // Built files, or the app's page for the path (see [`site`]).
        .fallback(site::fallback)
        .layer(axum::middleware::map_response(site::base_headers))
        .with_state(state)
}

/// The build this server runs, and whether its bot worker runs the same:
/// the deploy checks it after shipping, and the `deploy-watch` workflow
/// compares it with `main`. The repository is public, so none of it is a
/// secret.
async fn version(State(app): State<AppState>) -> Response {
    let worker = app.env.remote.status();
    let body = json!({
        "commit": bots::commit(),
        "version": env!("CARGO_PKG_VERSION"),
        "protocol": bots::PROTOCOL,
        "worker": {
            "connected": worker.connected,
            "commit": worker.commit,
        },
    });
    ([(axum::http::header::CACHE_CONTROL, "no-store")], Json(body)).into_response()
}

async fn presets() -> Json<Vec<&'static str>> {
    Json(Preset::ALL.iter().map(|p| p.name()).collect())
}

/// Where a bot worker dials in; it must present the bot token.
async fn bot_worker(State(app): State<AppState>, headers: axum::http::HeaderMap, ws: WebSocketUpgrade) -> Response {
    let presented = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    let allowed = match (&app.config.bot_token, presented) {
        (Some(token), Some(given)) => constant_time_eq(token.as_bytes(), given.as_bytes()),
        _ => false,
    };
    if !allowed {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    ws.max_message_size(limit::WS_MAX_MESSAGE)
        .max_frame_size(limit::WS_MAX_MESSAGE)
        .on_upgrade(move |socket| async move { app.env.remote.serve(socket).await })
}

/// Compares secrets without leaking how much of them matched.
pub(crate) fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// The rulebook's worked examples (see [`mighty::score::Examples`]) under
/// the rules in the body, which may be any a table could play.
async fn rule_examples(body: axum::body::Bytes) -> Response {
    let rules: Rules = match serde_json::from_slice(&body) {
        Ok(rules) => rules,
        Err(e) => return ServerError::with_detail(ErrorCode::BadMessage, e).respond(StatusCode::BAD_REQUEST),
    };
    if let Err(e) = rules.validate() {
        return ServerError::rules(e).respond(StatusCode::BAD_REQUEST);
    }
    Json(mighty::score::Examples::new(&rules)).into_response()
}

/// The full rules of a preset, for the rulebook.
async fn preset_rules(Path(id): Path<String>) -> Response {
    match id.parse::<Preset>() {
        Ok(preset) => Json(preset.rules()).into_response(),
        Err(e) => ServerError::with_detail(ErrorCode::UnknownPreset, e).respond(StatusCode::NOT_FOUND),
    }
}

/// A JSON body, or what was wrong with it as a [`ServerError`]. An empty
/// body is the type's default.
fn parse_body<T: serde::de::DeserializeOwned + Default>(body: &[u8]) -> Result<T, ServerError> {
    if body.iter().all(u8::is_ascii_whitespace) {
        return Ok(T::default());
    }
    serde_json::from_slice(body).map_err(|e| ServerError::with_detail(ErrorCode::BadMessage, e))
}

async fn create_room(State(app): State<AppState>, ClientIp(ip): ClientIp, body: axum::body::Bytes) -> Response {
    if !app.limits.tables.allow(ip) {
        return too_many();
    }
    let request: CreateRoom = match parse_body(&body) {
        Ok(request) => request,
        Err(e) => return e.respond(StatusCode::BAD_REQUEST),
    };
    let mut settings = MightySettings::new(request.preset.unwrap_or(catalog::DEFAULT_PRESET));
    Mighty::freeze(&mut settings);
    // Rules no different from the preset's are the preset's.
    settings.rules = request.rules.filter(|r| Some(r) != settings.preset_rules.as_ref());
    if let Err(e) = Mighty::validate(&settings) {
        return e.respond(StatusCode::BAD_REQUEST);
    }
    match app.create_room::<Mighty>(settings) {
        Some(id) => Json(CreatedRoom { id }).into_response(),
        None => {
            tracing::warn!(max = app.config.max_rooms, "refused a table: too many are open");
            ServerError::new(ErrorCode::TooManyTables).respond(StatusCode::SERVICE_UNAVAILABLE)
        }
    }
}

#[derive(Deserialize)]
struct Report {
    text: String,
    #[serde(default)]
    room: Option<String>,
    #[serde(default)]
    seat: Option<usize>,
    /// Browser, screen size and such, as the client describes itself.
    #[serde(default)]
    client: Value,
}

/// Reports (and new client errors) kept at most this long, in days.
pub const REPORT_DAYS: u64 = 14;
/// The longest report kept, in characters.
pub const REPORT_MAX: usize = 2000;
/// The largest report body: [`REPORT_MAX`] characters of text and the client's description.
const REPORT_BODY: usize = 32 * 1024;

/// Saves a player's problem report with the room's state and move log under
/// `<data>/reports`, where the owner reads it on `/stats`.
async fn report(State(app): State<AppState>, ClientIp(ip): ClientIp, Json(r): Json<Report>) -> Response {
    if !app.limits.reports.allow(ip) {
        return too_many();
    }
    let text: String = r.text.trim().chars().take(REPORT_MAX).collect();
    if text.is_empty() {
        return ServerError::new(ErrorCode::EmptyReport).respond(StatusCode::BAD_REQUEST);
    }
    if !app.limits.report_files.take() {
        return ServerError::new(ErrorCode::TooManyReports).respond(StatusCode::TOO_MANY_REQUESTS);
    }
    let room_id = r.room.filter(|id| id.len() <= 12);
    let mut room = Value::Null;
    if let Some(tx) = room_id.as_deref().and_then(|id| app.room(id)) {
        let (reply, rx) = tokio::sync::oneshot::channel();
        if tx.send(Command::Report { reply }).is_ok() {
            room = tokio::time::timeout(Duration::from_secs(2), rx)
                .await
                .ok()
                .and_then(Result::ok)
                .unwrap_or(Value::Null);
        }
    }
    let now = stats::now();
    app.stats.record_at(now, Event::Report { table: room_id.clone() });
    let report = json!({
        "time": now,
        "version": env!("CARGO_PKG_VERSION"),
        "text": text,
        "room_id": room_id,
        "seat": r.seat,
        "client": r.client,
        "room": room,
    });
    tracing::warn!(report = %report, "problem report");
    if let Some(dir) = &app.config.data {
        let dir = dir.join("reports");
        let name = format!("{now}-{:06x}.json", rand::rng().random::<u32>() & 0xff_ffff);
        let saved = std::fs::create_dir_all(&dir).and_then(|()| std::fs::write(dir.join(name), report.to_string()));
        if let Err(e) = saved {
            tracing::error!("could not save the report: {e}");
        }
        prune_reports(&dir, now);
    }
    StatusCode::NO_CONTENT.into_response()
}

/// Deletes reports older than [`REPORT_DAYS`]; their names start with the time.
pub(crate) fn prune_reports(dir: &std::path::Path, now: u64) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let time = name.to_str().and_then(|n| n.split('-').next()?.parse::<u64>().ok());
        if time.is_some_and(|t| now.saturating_sub(t) > REPORT_DAYS * 86_400) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

async fn room_info(State(app): State<AppState>, Path(id): Path<String>) -> Response {
    match app.room(&id) {
        Some(_) => Json(json!({ "id": id, "game": Mighty::NAME })).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn connect(
    State(app): State<AppState>,
    ClientIp(ip): ClientIp,
    Path(id): Path<String>,
    ws: WebSocketUpgrade,
) -> Response {
    if !app.limits.sockets.allow(ip) {
        return too_many();
    }
    let Some(room) = app.room(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let conn = app.rooms.next_conn.fetch_add(1, Ordering::Relaxed);
    ws.max_message_size(limit::WS_MAX_MESSAGE)
        .max_frame_size(limit::WS_MAX_MESSAGE)
        .on_upgrade(move |socket| serve_connection(socket, room, conn))
}

/// A table connection's message limits; see [`limit::ws_messages`].
struct ConnLimits {
    messages: limit::ConnBucket,
    hints: limit::ConnBucket,
    /// Messages dropped in a row.
    over: u32,
}

/// What becomes of one message under a connection's limits.
#[derive(Debug, PartialEq, Eq)]
enum Admit {
    Pass,
    Drop,
    /// The client keeps flooding: hang up.
    Close,
}

impl ConnLimits {
    fn new() -> ConnLimits {
        ConnLimits {
            messages: limit::ws_messages(),
            hints: limit::ws_hints(),
            over: 0,
        }
    }

    /// Counts one incoming message against the connection's rate.
    fn admit(&mut self) -> Admit {
        if self.messages.take() {
            self.over = 0;
            Admit::Pass
        } else {
            self.over += 1;
            if self.over >= limit::WS_FLOOD {
                Admit::Close
            } else {
                Admit::Drop
            }
        }
    }
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
    let error = |error: ServerError| {
        let _ = errors.send(error.message());
    };
    let mut limits = ConnLimits::new();
    loop {
        tokio::select! {
            incoming = stream.next() => match incoming {
                Some(Ok(message @ (Message::Text(_) | Message::Binary(_)))) => {
                    match limits.admit() {
                        Admit::Pass => {}
                        // Too fast: drop it quietly rather than answer each one.
                        Admit::Drop => continue,
                        Admit::Close => {
                            tracing::warn!(conn, "closing a connection that floods its table");
                            break;
                        }
                    }
                    let Message::Text(text) = message else { continue };
                    match serde_json::from_str::<ClientMsg>(&text) {
                        Ok(ClientMsg::Hint) if !limits.hints.take() => error(ErrorCode::HintsTooOften.into()),
                        Ok(msg) => {
                            let _ = room.send(Command::Message { conn, msg });
                        }
                        Err(e) => error(ServerError::with_detail(ErrorCode::BadMessage, e)),
                    }
                }
                Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                Some(Ok(_)) => {}
            },
            _ = &mut writer => break,
        }
    }
    let _ = room.send(Command::Disconnect { conn });
    writer.abort();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_flooding_connection_is_dropped_then_closed() {
        let mut limits = ConnLimits::new();
        let mut seen = Vec::new();
        for _ in 0..1000 {
            let admit = limits.admit();
            if seen.last() != Some(&admit) {
                seen.push(admit);
            }
            if seen.last() == Some(&Admit::Close) {
                break;
            }
        }
        assert_eq!(seen, [Admit::Pass, Admit::Drop, Admit::Close]);
    }
}
