//! HTTP and WebSocket front end. Rooms live in memory; each runs as its own
//! task (see [`room`]).

pub mod bots;
pub mod dashboard;
pub mod errors;
pub mod limit;
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
use futures_util::{SinkExt, StreamExt};
use limit::{ClientIp, Limits, too_many};
use mighty::Mighty;
use mighty::rules::Preset;
use rand::Rng;
use room::{ClientMsg, Command, ConnId, Room};
use serde::Deserialize;
use serde_json::{Value, json};
use session::{MightySettings, SessionGame};
use stats::{Event, Stats};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc::{self, UnboundedSender};

type Registry = Arc<Mutex<HashMap<String, UnboundedSender<Command>>>>;

#[derive(Clone)]
pub struct AppState {
    rooms: Registry,
    next_conn: Arc<AtomicU64>,
    bot_delay: Duration,
    /// Most a 고수 bot may think per move, if less than its share of the delay.
    bot_think: Option<Duration>,
    max_rooms: usize,
    /// A room with nobody connected for this long closes.
    idle: Duration,
    /// Where rooms are saved so they survive a restart, if anywhere.
    data: Option<PathBuf>,
    /// A machine that thinks for bots, if one has dialled in.
    remote: Arc<bots::RemoteBots>,
    /// The secret a bot worker must present; without one, none may connect.
    bot_token: Option<String>,
    /// When recent problem reports arrived, to cap them per hour.
    reports: Arc<Mutex<Vec<std::time::Instant>>>,
    /// When new client errors were last filed as issues, to cap them per hour.
    error_issues: Arc<Mutex<Vec<std::time::Instant>>>,
    stats: Arc<Stats>,
    /// The secret that opens `/stats`; without one, it does not exist.
    stats_token: Option<String>,
    limits: Arc<Limits>,
    /// The built web client, if served.
    web: Option<PathBuf>,
    /// The site's own address, for canonical links and the sitemap.
    site_url: String,
    /// Cloudflare Web Analytics token, if pages should load its beacon.
    beacon: Option<String>,
    /// How long a second of a table's turn limit lasts (shorter in tests).
    turn_second: Duration,
}

impl AppState {
    pub fn new(bot_delay: Duration) -> AppState {
        AppState {
            rooms: Arc::default(),
            next_conn: Arc::default(),
            bot_delay,
            bot_think: None,
            max_rooms: 500,
            idle: Duration::from_secs(30 * 60),
            data: None,
            reports: Arc::default(),
            error_issues: Arc::default(),
            remote: Arc::default(),
            bot_token: None,
            stats: Arc::new(Stats::in_memory()),
            stats_token: None,
            limits: Arc::default(),
            web: None,
            site_url: site::SITE_URL.to_string(),
            beacon: None,
            turn_second: Duration::from_secs(1),
        }
    }

    /// Opens `/stats` and `/api/stats` to whoever presents `token`.
    pub fn with_stats_token(self, token: String) -> AppState {
        AppState {
            stats_token: Some(token),
            ..self
        }
    }

    /// Adds the Cloudflare Web Analytics beacon with this token to every page.
    pub fn with_beacon(self, token: String) -> AppState {
        AppState {
            beacon: Some(token),
            ..self
        }
    }

    /// Where the site is served, for canonical links; [`site::SITE_URL`] by default.
    pub fn with_site_url(self, url: String) -> AppState {
        AppState {
            site_url: url.trim_end_matches('/').to_string(),
            ..self
        }
    }

    /// Makes a turn limit's seconds last `second` instead, so a test need
    /// not wait out real turns.
    pub fn with_turn_second(self, second: Duration) -> AppState {
        AppState {
            turn_second: second,
            ..self
        }
    }

    /// Replaces the rate limits, say to loosen them for a test.
    pub fn with_rate_limits(self, limits: Limits) -> AppState {
        AppState {
            limits: Arc::new(limits),
            ..self
        }
    }

    /// The stats log, for recording from outside a request.
    pub fn stats(&self) -> Arc<Stats> {
        self.stats.clone()
    }

    /// Accepts bot workers that present `token`; see [`bots`]. From then
    /// on, tables thinking for themselves are warned about.
    pub fn with_bot_token(self, token: String) -> AppState {
        self.remote.expect_worker();
        AppState {
            bot_token: Some(token),
            ..self
        }
    }

    /// The connection to a bot worker, if one dials in.
    pub fn remote_bots(&self) -> Arc<bots::RemoteBots> {
        self.remote.clone()
    }

    /// Caps bot thinking per move, for a server short on CPU.
    pub fn with_bot_think(self, think: Duration) -> AppState {
        AppState {
            bot_think: Some(think),
            ..self
        }
    }

    /// Saves every room under `dir` as it changes (see
    /// [`AppState::restore_rooms`]) and keeps the stats log there.
    pub fn with_data(self, dir: PathBuf) -> AppState {
        let stats = match Stats::open(&dir) {
            Ok(stats) => Arc::new(stats),
            Err(e) => {
                tracing::error!(dir = %dir.display(), "could not open the stats log, keeping it in memory: {e}");
                self.stats.clone()
            }
        };
        AppState {
            data: Some(dir),
            stats,
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
                .map(freeze_saved::<Mighty>)
                .and_then(|snapshot| Room::<Mighty>::restore(snapshot, self.bot_delay));
            match loaded {
                Ok(mut room) => {
                    room.use_turn_second(self.turn_second);
                    if let Some(think) = self.bot_think {
                        room.limit_think(think);
                    }
                    room.use_remote(self.remote.clone());
                    room.use_stats(self.stats.clone());
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

    /// Asks every room to save itself and end, keeping its file for the next
    /// server to restore (see [`AppState::restore_rooms`]); returns how many
    /// did within `wait`. For a restart: connections drop, and clients
    /// reconnect to the next server with their seat tokens.
    pub async fn shutdown(&self, wait: Duration) -> usize {
        let rooms: Vec<_> = self
            .rooms
            .lock()
            .expect("room registry poisoned")
            .values()
            .cloned()
            .collect();
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
        self.rooms.lock().expect("room registry poisoned").len()
    }

    /// The server's live state, for `/stats`.
    pub fn server_status(&self) -> dashboard::ServerStatus {
        dashboard::ServerStatus {
            rooms: self.open_rooms(),
            max_rooms: self.max_rooms,
            worker: self.remote.status(),
        }
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
    pub fn create_room<G: SessionGame>(&self, mut settings: G::Settings) -> Option<String> {
        const ALPHABET: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";
        G::freeze(&mut settings);
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
        let mut room = Room::<G>::new(id.clone(), settings.clone(), self.bot_delay);
        room.use_turn_second(self.turn_second);
        if let Some(think) = self.bot_think {
            room.limit_think(think);
        }
        room.use_remote(self.remote.clone());
        room.use_stats(self.stats.clone());
        self.stats.record(Event::TableCreated {
            table: id.clone(),
            preset: G::preset_id(&settings).to_string(),
        });
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
            tracing::info!(room = key, "room closed");
        });
        rooms.insert(id, tx);
    }

    fn room(&self, id: &str) -> Option<UnboundedSender<Command>> {
        self.rooms.lock().expect("room registry poisoned").get(id).cloned()
    }
}

/// Pins the settings of a room saved before rooms pinned their rules; see
/// [`SessionGame::freeze`]. Pinned settings, or ones that do not load, pass.
fn freeze_saved<G: SessionGame>(mut snapshot: Value) -> Value {
    if let Ok(mut settings) = serde_json::from_value::<G::Settings>(snapshot["settings"].clone()) {
        G::freeze(&mut settings);
        if let Ok(frozen) = serde_json::to_value(settings) {
            snapshot["settings"] = frozen;
        }
    }
    snapshot
}

/// Refuses a body over `max` bytes. One whose declared length is over is
/// refused before any of it is read, so a client that waits for `100
/// Continue` never sends it.
fn body_limit(max: usize) -> tower_http::limit::RequestBodyLimitLayer {
    tower_http::limit::RequestBodyLimitLayer::new(max)
}

/// The API under `/api`, plus the built web client from `web_dir` if given.
pub fn router(state: AppState, web_dir: Option<PathBuf>) -> Router {
    let state = AppState { web: web_dir, ..state };
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/version", get(version))
        .route("/api/presets", get(presets))
        .route("/api/presets/{id}", get(preset_rules))
        .route("/api/rooms", post(create_room).layer(body_limit(4 * 1024)))
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
    let worker = app.remote.status();
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
    let allowed = match (&app.bot_token, presented) {
        (Some(token), Some(given)) => constant_time_eq(token.as_bytes(), given.as_bytes()),
        _ => false,
    };
    if !allowed {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    ws.max_message_size(limit::WS_MAX_MESSAGE)
        .max_frame_size(limit::WS_MAX_MESSAGE)
        .on_upgrade(move |socket| async move { app.remote.serve(socket).await })
}

/// Compares secrets without leaking how much of them matched.
pub(crate) fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0, |acc, (x, y)| acc | (x ^ y)) == 0
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

async fn create_room(State(app): State<AppState>, ClientIp(ip): ClientIp, body: Option<Json<CreateRoom>>) -> Response {
    if !app.limits.tables.allow(ip) {
        return too_many();
    }
    let preset = body.and_then(|Json(b)| b.preset).unwrap_or(Preset::Gshs);
    match app.create_room::<Mighty>(MightySettings::new(preset)) {
        Some(id) => Json(json!({ "id": id })).into_response(),
        None => {
            tracing::warn!(max = app.max_rooms, "refused a table: too many are open");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                "지금은 열린 테이블이 너무 많아요. 잠시 뒤에 다시 해 주세요.",
            )
                .into_response()
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

/// Reports kept at most this long, and accepted at most this often.
pub(crate) const REPORT_DAYS: u64 = 14;
const REPORTS_PER_HOUR: usize = 30;
/// The largest report body: 2000 characters of text and the client's description.
const REPORT_BODY: usize = 32 * 1024;

/// Saves a player's problem report with the room's state and move log under
/// `<data>/reports`, where the owner reads it on `/stats`.
async fn report(State(app): State<AppState>, ClientIp(ip): ClientIp, Json(r): Json<Report>) -> Response {
    if !app.limits.reports.allow(ip) {
        return too_many();
    }
    let text: String = r.text.trim().chars().take(2000).collect();
    if text.is_empty() {
        return (StatusCode::BAD_REQUEST, "describe the problem").into_response();
    }
    {
        let mut recent = app.reports.lock().expect("report times poisoned");
        recent.retain(|t| t.elapsed() < Duration::from_secs(3600));
        if recent.len() >= REPORTS_PER_HOUR {
            return (StatusCode::TOO_MANY_REQUESTS, "too many reports").into_response();
        }
        recent.push(std::time::Instant::now());
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
    if let Some(dir) = &app.data {
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
    let conn = app.next_conn.fetch_add(1, Ordering::Relaxed);
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
    let error = |message: String| {
        let _ = errors.send(json!({ "type": "error", "message": message }).to_string());
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
                        Ok(ClientMsg::Hint) if !limits.hints.take() => error("hints too often".into()),
                        Ok(msg) => {
                            let _ = room.send(Command::Message { conn, msg });
                        }
                        Err(e) => error(format!("bad message: {e}")),
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
