//! HTTP and WebSocket front end. Rooms live in memory; each runs as its own
//! task (see [`room`]).

pub mod bots;
pub mod catalog;
pub mod codegen;
pub mod command_protocol;
pub mod config;
pub mod dashboard;
pub mod errors;
pub mod game;
pub mod ingress;
pub mod limit;
pub mod outbound;
pub mod protocol;
pub mod resource_budget;
pub mod room;
pub mod site;
pub mod stats;
pub mod work_budget;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
pub use config::{Config, IDLE_MINUTES};
use engine::TableBots;
use futures_util::StreamExt;
use game::{GameCatalog, ServerGame};
use limit::{ClientIp, Limits, too_many};
use protocol::ClientMsg;
use protocol::{CreatedRoom, ErrorCode, ServerError};
use rand::Rng;
use room::{BotConfig, Command, ConnId, Room, RoomEnv};
use serde::Deserialize;
use serde_json::{Value, json};
use stats::{Event, Stats};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// An open table: where its commands go, and the game it plays.
#[derive(Clone)]
struct OpenRoom {
    tx: ingress::Sender,
    game: &'static str,
    entry_refusal: Arc<Mutex<Option<protocol::NativeCapacityReason>>>,
}

/// The open tables, by id.
#[derive(Default)]
struct Rooms {
    open: Mutex<HashMap<String, OpenRoom>>,
    /// Preserved files that cannot safely be opened under current limits.
    unavailable: Mutex<HashMap<String, PreservedRoom>>,
    restoring: Mutex<()>,
    /// The next table connection's id.
    next_conn: AtomicU64,
}

struct PreservedRoom {
    reason: protocol::NativeCapacityReason,
    // Retained for operator recovery, never included in HTTP responses.
    _path: std::path::PathBuf,
}

impl Rooms {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, OpenRoom>> {
        self.open.lock().expect("room registry poisoned")
    }

    fn connection_id(&self) -> Option<u64> {
        let mut current = self.next_conn.load(Ordering::Relaxed);
        loop {
            let next = current.checked_add(1)?;
            match self
                .next_conn
                .compare_exchange_weak(current, next, Ordering::Relaxed, Ordering::Relaxed)
            {
                Ok(_) => return Some(current),
                Err(actual) => current = actual,
            }
        }
    }
}

/// What every request handler shares: the server's settings, the games it
/// offers, its tables, what the tables share ([`RoomEnv`]), the rate limits
/// and the stats.
#[derive(Clone)]
pub struct AppState {
    config: Arc<Config>,
    games: Arc<GameCatalog>,
    rooms: Arc<Rooms>,
    env: Arc<RoomEnv>,
    limits: Arc<Limits>,
    stats: Arc<Stats>,
    outbound: outbound::Pool,
    ingress: ingress::Pool,
}

impl AppState {
    /// A server as `config` sets it up. With a data directory, the stats
    /// log is kept there (see [`AppState::restore_rooms`] for the tables).
    pub fn new(config: Config) -> AppState {
        assert!(
            config.max_rooms as u128 <= crate::command_protocol::MAX_COMMAND_SEQUENCE as u128,
            "room limit exceeds exact public integer range"
        );
        let resources = config
            .resource_limits()
            .validate()
            .expect("valid native resource limits");
        let outbound = outbound::Pool::new(config.outbound_policy()).expect("valid outbound limits");
        let ingress = ingress::Pool::new(config.ingress_policy()).expect("valid ingress limits");
        let cognition = crate::work_budget::Budget::new(config.cognition_jobs);
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
            remote,
            stats: stats.clone(),
            data: config.data.clone(),
            hints: limit::HintPool::default(),
            resources,
            cognition,
        };
        AppState {
            config: Arc::new(config),
            games: Arc::new(GameCatalog::standard()),
            rooms: Arc::default(),
            env: Arc::new(env),
            limits: Arc::default(),
            stats,
            outbound,
            ingress,
        }
    }

    pub fn config(&self) -> &Config {
        &self.config
    }

    /// The games this server offers.
    pub fn games(&self) -> &GameCatalog {
        &self.games
    }

    /// What every room on this server shares.
    pub(crate) fn room_env(&self) -> Arc<RoomEnv> {
        self.env.clone()
    }

    /// The stats log, for recording from outside a request.
    pub fn stats(&self) -> Arc<Stats> {
        self.stats.clone()
    }

    /// The connection to a bot worker, if one dials in.
    pub fn remote_bots(&self) -> Arc<bots::RemoteBots> {
        self.env.remote.clone()
    }

    /// The places for hint searches the server's rooms share.
    pub fn hint_pool(&self) -> limit::HintPool {
        self.env.hints.clone()
    }

    /// Reopens the rooms saved under the data directory, returning how many.
    /// A file that no longer loads (say, after an incompatible rules change)
    /// is set aside as `.bad` rather than deleted.
    pub fn restore_rooms(&self) -> std::io::Result<usize> {
        let Some(dir) = &self.config.data else { return Ok(0) };
        let _restore = self.rooms.restoring.lock().expect("restore registry poisoned");
        std::fs::create_dir_all(dir)?;
        let mut restored = 0;
        for entry in std::fs::read_dir(dir)? {
            let path = entry?.path();
            if path.extension().is_none_or(|e| e != "json") {
                continue;
            }
            let Some(id) = path.file_stem().and_then(|id| id.to_str()).filter(|id| {
                !id.is_empty()
                    && id.len() <= 128
                    && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            }) else {
                continue;
            };
            // A preserved unavailable entry reserves its identity just like an
            // open room. Repeated restore calls never spawn a duplicate actor.
            if self.rooms.lock().contains_key(id)
                || self
                    .rooms
                    .unavailable
                    .lock()
                    .expect("room registry poisoned")
                    .contains_key(id)
            {
                continue;
            }
            // Excess files remain a lazy preserved registry. Do not parse or
            // allocate one actor/metadata entry per arbitrary directory file.
            if self.open_rooms() >= self.config.max_rooms {
                continue;
            }
            let loaded = (|| {
                use game::RestoreError;
                use std::io::Read;
                let cap = self.config.resource_snapshot_bytes;
                let capacity = || {
                    RestoreError::Capacity(protocol::NativeCapacityReason::Capacity {
                        resource: resource_budget::Resource::Snapshot,
                        limit: cap,
                    })
                };
                let file = std::fs::File::open(&path).map_err(|e| RestoreError::Invalid(e.to_string()))?;
                if file.metadata().map_err(|e| RestoreError::Invalid(e.to_string()))?.len() > cap as u64 {
                    return Err(capacity());
                }
                // Bound the read too: metadata is not a defense against a file
                // growing between inspection and read.
                let mut text = Vec::new();
                file.take((cap as u64).saturating_add(1))
                    .read_to_end(&mut text)
                    .map_err(|e| RestoreError::Invalid(e.to_string()))?;
                if text.len() > cap {
                    return Err(capacity());
                }
                let snapshot: Value =
                    serde_json::from_slice(&text).map_err(|e| RestoreError::Invalid(e.to_string()))?;
                if snapshot.get("id").and_then(Value::as_str) != Some(id) {
                    return Err(RestoreError::Invalid(
                        "snapshot identity does not match its file".into(),
                    ));
                }
                let game_id = snapshot.get("game").and_then(Value::as_str).unwrap_or_default();
                let game = self.games.get(game_id).ok_or(RestoreError::Capacity(
                    protocol::NativeCapacityReason::UnsupportedProfile,
                ))?;
                game.restore(self, snapshot)
            })();
            match loaded {
                Ok(_) => restored += 1,
                Err(game::RestoreError::Capacity(reason)) => {
                    tracing::warn!(file = %path.display(), ?reason, "preserving resource-unavailable room");
                    self.rooms
                        .unavailable
                        .lock()
                        .expect("room registry poisoned")
                        .insert(id.to_owned(), PreservedRoom { reason, _path: path });
                }
                Err(game::RestoreError::Invalid(e)) => {
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
        let rooms: Vec<_> = self.rooms.lock().values().map(|r| r.tx.clone()).collect();
        let mut pending = Vec::new();
        for room in rooms {
            let (done, rx) = tokio::sync::oneshot::channel();
            if room.send(Command::Shutdown { done }).is_ok() {
                pending.push(rx);
            }
        }
        let all = futures_util::future::join_all(pending);
        let saved = match tokio::time::timeout(wait, all).await {
            Ok(results) => results
                .into_iter()
                .filter(|result| matches!(result, Ok(Ok(()))))
                .count(),
            Err(_) => 0,
        };
        let stats = self.stats.clone();
        let _ = tokio::task::spawn_blocking(move || stats.flush()).await;
        saved
    }

    /// How many rooms are open now.
    pub fn open_rooms(&self) -> usize {
        self.rooms.lock().len() + self.rooms.unavailable.lock().expect("room registry poisoned").len()
    }

    /// The server's live state, for `/stats`.
    pub fn server_status(&self) -> dashboard::ServerStatus {
        dashboard::ServerStatus {
            rooms: self.open_rooms(),
            max_rooms: self.config.max_rooms,
            worker: self.env.remote.status(),
        }
    }

    /// Opens a room of game `G` with `bots`, and returns its id, which is
    /// also its share link, or `None` when the server already has as many
    /// rooms as it allows.
    pub fn create_room<G: ServerGame>(&self, settings: G::Settings, bots: Arc<dyn TableBots<G>>) -> Option<String> {
        self.try_create_room::<G>(settings, bots).ok()
    }

    pub(crate) fn try_create_room<G: ServerGame>(
        &self,
        mut settings: G::Settings,
        bots: Arc<dyn TableBots<G>>,
    ) -> Result<String, game::CreateError> {
        const ALPHABET: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";
        G::freeze(&mut settings);
        let capacity = |error| game::CreateError::Capacity(protocol::NativeCapacityReason::from_budget(&error, false));
        resource_budget::ResourceProfile::table::<G>(&settings).map_err(capacity)?;
        G::validate(&G::table_rules(&settings))
            .map_err(|error| game::CreateError::Rejected(StatusCode::BAD_REQUEST, ServerError::rules(&error)))?;
        // Serialize capacity admission with restoration's check/load/spawn.
        let _restore = self.rooms.restoring.lock().expect("restore registry poisoned");
        let mut rooms = self.rooms.lock();
        let unavailable = self.rooms.unavailable.lock().expect("room registry poisoned");
        if rooms.len() + unavailable.len() >= self.config.max_rooms {
            return Err(game::CreateError::Rejected(
                StatusCode::SERVICE_UNAVAILABLE,
                ServerError::new(ErrorCode::TooManyTables),
            ));
        }
        let mut rng = rand::rng();
        let id = loop {
            let id: String = (0..6)
                .map(|_| char::from(ALPHABET[rng.random_range(0..ALPHABET.len())]))
                .collect();
            if !rooms.contains_key(&id)
                && !unavailable.contains_key(&id)
                && self
                    .config
                    .data
                    .as_ref()
                    .is_none_or(|dir| !dir.join(format!("{id}.json")).exists())
            {
                break id;
            }
        };
        let preset = G::preset_id(&settings).to_string();
        let mut room = Room::<G>::new(id.clone(), settings, self.env.clone(), bots);
        room.admit_restore(self.config.outbound_message_bytes)
            .map_err(capacity)?;
        self.stats.record(Event::TableCreated {
            table: id.clone(),
            preset,
        });
        self.spawn_room(&mut rooms, id.clone(), room);
        Ok(id)
    }

    /// Runs a room restored from its file, returning its id.
    pub(crate) fn open_restored<G: ServerGame>(&self, room: Room<G>) -> String {
        let id = room.id().to_string();
        let mut rooms = self.rooms.lock();
        self.spawn_room(&mut rooms, id.clone(), room);
        id
    }

    fn spawn_room<G: ServerGame>(&self, rooms: &mut HashMap<String, OpenRoom>, id: String, room: Room<G>) {
        let (tx, rx) = self.ingress.channel();
        let (registry, key) = (self.rooms.clone(), id.clone());
        let entry_refusal = room.entry_status();
        let retired_status = entry_refusal.clone();
        let preserved_path = self.config.data.as_ref().map(|dir| dir.join(format!("{id}.json")));
        tokio::spawn(async move {
            room.run(rx).await;
            let reason = retired_status.lock().expect("entry status lock").clone();
            // Keep unavailable metadata before retiring the open identity; a
            // concurrent creation can never reuse the preserved room ID.
            if let (Some(reason), Some(path)) = (reason, preserved_path) {
                registry
                    .unavailable
                    .lock()
                    .expect("room registry poisoned")
                    .insert(key.clone(), PreservedRoom { reason, _path: path });
            }
            registry.lock().remove(&key);
            tracing::info!(room = key, "room closed");
        });
        rooms.insert(
            id,
            OpenRoom {
                tx,
                game: G::ID,
                entry_refusal,
            },
        );
    }

    /// The open room `id`; one closing (it stopped taking commands) is gone.
    fn room(&self, id: &str) -> Option<ingress::Sender> {
        self.open_room(id).map(|r| r.tx)
    }

    fn open_room(&self, id: &str) -> Option<OpenRoom> {
        self.rooms.lock().get(id).filter(|r| !r.tx.is_closed()).cloned()
    }

    fn unavailable_reason(&self, id: &str) -> Option<protocol::NativeCapacityReason> {
        let status = self.rooms.lock().get(id).map(|room| room.entry_refusal.clone());
        if let Some(reason) = status.and_then(|status| status.lock().expect("entry status lock").clone()) {
            return Some(reason);
        }
        if let Some(room) = self.rooms.unavailable.lock().expect("room registry poisoned").get(id) {
            return Some(room.reason.clone());
        }
        // A capacity-deferred file keeps its identity without an unbounded
        // in-memory registry. Only bounded safe path components are admitted.
        if !id.is_empty()
            && id.len() <= 128
            && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            && !self.rooms.lock().contains_key(id)
            && self
                .config
                .data
                .as_ref()
                .is_some_and(|dir| dir.join(format!("{id}.json")).is_file())
        {
            return Some(protocol::NativeCapacityReason::Capacity {
                resource: resource_budget::Resource::Rooms,
                limit: self.config.max_rooms,
            });
        }
        None
    }

    fn unavailable_response(&self, id: &str) -> Option<Response> {
        self.unavailable_reason(id).map(|reason| {
            (
                StatusCode::INSUFFICIENT_STORAGE,
                Json(protocol::NativeRoomUnavailable::ResourceCapacity { reason }),
            )
                .into_response()
        })
    }

    /// The game `id`, as a route names it.
    fn game(&self, id: &str) -> Option<&dyn game::GameEntry> {
        self.games.get(id)
    }
}

/// Refuses a body over `max` bytes. One whose declared length is over is
/// refused before any of it is read, so a client that waits for `100
/// Continue` never sends it.
fn body_limit(max: usize) -> tower_http::limit::RequestBodyLimitLayer {
    tower_http::limit::RequestBodyLimitLayer::new(max)
}

/// The API under `/api`, plus the built web client from [`Config::web`] if given.
///
/// What belongs to a game is under `/api/games/{game}/`: its presets, its
/// rulebook's examples and new tables. Tables themselves are by id alone
/// (`/api/rooms/{id}`), whatever their game. The routes from before games
/// had ids (`/api/presets`, `/api/rooms`, `/api/rules/examples`) stay, for
/// the first game ([`GameCatalog::default_game`]), so live clients and
/// links keep working.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/version", get(version))
        .route("/api/games", get(games))
        .route("/api/games/{game}/presets", get(game_presets))
        .route("/api/games/{game}/presets/{id}", get(game_preset_rules))
        .route(
            "/api/games/{game}/rooms",
            post(game_create_room).layer(body_limit(16 * 1024)),
        )
        .route(
            "/api/games/{game}/rules/examples",
            post(game_rule_examples).layer(body_limit(16 * 1024)),
        )
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

/// The games this server offers, in the order registered.
async fn games(State(app): State<AppState>) -> Json<Value> {
    let games: Vec<Value> = app
        .games
        .games()
        .map(|g| json!({ "id": g.id(), "name": g.name() }))
        .collect();
    Json(Value::Array(games))
}

/// A game's presets, by id, in the game's own order.
async fn game_presets(State(app): State<AppState>, Path(game): Path<String>) -> Response {
    match app.game(&game) {
        Some(game) => Json(game.presets()).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn game_preset_rules(State(app): State<AppState>, Path((game, id)): Path<(String, String)>) -> Response {
    match app.game(&game) {
        Some(game) => respond_preset_rules(game, &id),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn game_rule_examples(
    State(app): State<AppState>,
    Path(game): Path<String>,
    body: axum::body::Bytes,
) -> Response {
    match app.game(&game) {
        Some(game) => respond_examples(game, &body),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn game_create_room(
    State(app): State<AppState>,
    ClientIp(ip): ClientIp,
    Path(game): Path<String>,
    body: axum::body::Bytes,
) -> Response {
    match app.game(&game) {
        Some(game) => respond_create(&app, ip, game, &body),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// `/api/presets`: the first game's presets.
async fn presets(State(app): State<AppState>) -> Json<Vec<&'static str>> {
    Json(app.games.default_game().presets())
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

/// `/api/rules/examples`: the first game's rulebook examples.
async fn rule_examples(State(app): State<AppState>, body: axum::body::Bytes) -> Response {
    respond_examples(app.games.default_game(), &body)
}

/// The rulebook's worked examples ([`engine::Table::examples`]) under the
/// rules in the body, which may be any a table could play.
fn respond_examples(game: &dyn game::GameEntry, body: &[u8]) -> Response {
    match game.examples(body) {
        Ok(examples) => Json(examples).into_response(),
        Err(e) => e.respond(StatusCode::BAD_REQUEST),
    }
}

/// `/api/presets/{id}`: a preset of the first game.
async fn preset_rules(State(app): State<AppState>, Path(id): Path<String>) -> Response {
    respond_preset_rules(app.games.default_game(), &id)
}

/// The full rules of a preset, for the rulebook.
fn respond_preset_rules(game: &dyn game::GameEntry, id: &str) -> Response {
    match game.preset_rules(id) {
        Some(rules) => Json(rules).into_response(),
        None => ServerError::with_detail(ErrorCode::UnknownPreset, format!("no preset {id:?}"))
            .respond(StatusCode::NOT_FOUND),
    }
}

/// A JSON body, or what was wrong with it as a [`ServerError`]. An empty
/// body is the type's default.
pub(crate) fn parse_body<T: serde::de::DeserializeOwned + Default>(body: &[u8]) -> Result<T, ServerError> {
    if body.iter().all(u8::is_ascii_whitespace) {
        return Ok(T::default());
    }
    serde_json::from_slice(body).map_err(|e| ServerError::with_detail(ErrorCode::BadMessage, e))
}

/// `/api/rooms`: a table of the first game.
async fn create_room(State(app): State<AppState>, ClientIp(ip): ClientIp, body: axum::body::Bytes) -> Response {
    respond_create(&app, ip, app.games.default_game(), &body)
}

/// A new table of `game`, as the body asks ([`protocol::CreateRoom`]).
fn respond_create(app: &AppState, ip: std::net::IpAddr, game: &dyn game::GameEntry, body: &[u8]) -> Response {
    if !app.limits.tables.allow(ip) {
        return too_many();
    }
    match game.create(app, body) {
        Ok(id) => Json(CreatedRoom { id }).into_response(),
        Err(game::CreateError::Rejected(status, e)) => e.respond(status),
        Err(game::CreateError::Capacity(reason)) => (
            StatusCode::INSUFFICIENT_STORAGE,
            Json(protocol::NativeRoomUnavailable::ResourceCapacity { reason }),
        )
            .into_response(),
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

/// A table's id and the game it plays.
async fn room_info(State(app): State<AppState>, Path(id): Path<String>) -> Response {
    if let Some(response) = app.unavailable_response(&id) {
        return response;
    }
    match app.open_room(&id) {
        Some(room) => Json(json!({ "id": id, "game": room.game })).into_response(),
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
    if let Some(response) = app.unavailable_response(&id) {
        return response;
    }
    let Some(room) = app.room(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Some(conn) = app.rooms.connection_id() else {
        return too_many();
    };
    let Some(guard) = room.connection(conn) else {
        return too_many();
    };
    ws.max_message_size(limit::WS_MAX_MESSAGE)
        .max_frame_size(limit::WS_MAX_MESSAGE)
        .on_upgrade(move |socket| serve_connection(socket, room, conn, app.outbound, guard))
}

/// A table connection's message limits; see [`limit::ws_messages`]. Every
/// limit on what one connection sends is kept here, before the room.
struct ConnLimits {
    messages: limit::ConnBucket,
    hints: limit::ConnBucket,
    reactions: limit::ConnBucket,
    /// Messages dropped in a row.
    over: u32,
}

/// What becomes of a message the connection may send at all.
#[derive(Debug, PartialEq, Eq)]
enum Verdict {
    /// On to the room.
    Send,
    /// Dropped quietly (a reaction too soon after the last).
    Drop,
    /// Refused, with why.
    Refuse(ServerError),
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
            reactions: limit::ws_reactions(),
            over: 0,
        }
    }

    /// Counts a message against its own kind's limit, if it has one.
    fn verdict(&mut self, msg: &ClientMsg) -> Verdict {
        match msg {
            ClientMsg::Hint if !self.hints.take() => Verdict::Refuse(ErrorCode::HintsTooOften.into()),
            // Too fast: drop it quietly rather than nag. (One the room does
            // not know goes on, to be refused.)
            ClientMsg::React { text } if room::REACTIONS.contains(&text.as_str()) && !self.reactions.take() => {
                Verdict::Drop
            }
            _ => Verdict::Send,
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

async fn serve_connection(
    socket: WebSocket,
    room: ingress::Sender,
    conn: ConnId,
    pool: outbound::Pool,
    mut guard: ingress::ConnectionGuard,
) {
    let (sink, mut stream) = socket.split();
    let (tx, rx) = pool.channel();
    // Weak, so the connection ends once the room lets go of it (the room
    // closed, or stopped for a restart).
    let errors = tx.downgrade();
    if let Err(error) = guard.connect(tx).await {
        // Even this final error uses the same byte accounting and abortable writer.
        if let Command::Connect { tx, .. } = *error.0 {
            let _ = tx.send(ServerError::new(ErrorCode::TableGone).message());
        }
        outbound::write(sink, rx).await;
        return;
    }
    let mut writer = tokio::spawn(outbound::write(sink, rx));
    let error = |error: ServerError| {
        if let Some(errors) = errors.upgrade() {
            let _ = errors.send(error.message());
        }
    };
    let mut limits = ConnLimits::new();
    let mut pressured = false;
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
                    // Charge the native source before constructing parsed values.
                    let Some(source) = room.reserve_source(text.len()) else {
                        if let Some(sender) = errors.upgrade() {sender.abort(outbound::AbortCause::Backpressure);}
                        pressured = true;
                        break;
                    };
                    match serde_json::from_str::<ClientMsg>(&text) {
                        Ok(msg) => match limits.verdict(&msg) {
                            Verdict::Send => {
                                tokio::select! {
                                    result = room.send_native(Command::Message {conn,msg},source) => {
                                        if result.is_err() {break;}
                                    }
                                    _ = &mut writer => break,
                                }
                            }
                            Verdict::Drop => {}
                            Verdict::Refuse(e) => error(e),
                        },
                        Err(e) => error(ServerError::with_detail(ErrorCode::BadMessage, e)),
                    }
                }
                Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                Some(Ok(_)) => {}
            },
            _ = &mut writer => break,
        }
    }
    // Reserved synchronous cleanup also runs on task cancellation or panic.
    drop(guard);
    if pressured {
        let _ = tokio::time::timeout(Duration::from_millis(200), &mut writer).await;
    }
    writer.abort();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn committed_entry_revision_exhaustion_is_507_and_idle_preserves_the_checkpoint() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("numeric.json");
        let mut snapshot = saved_lobby("numeric");
        snapshot["commands"]["room_version"] = json!(command_protocol::MAX_COMMAND_SEQUENCE - 4);
        std::fs::write(&path, serde_json::to_vec(&snapshot).unwrap()).unwrap();
        let app = AppState::new(Config {
            data: Some(dir.path().into()),
            idle_minutes: 0.1 / 60.0,
            ..Default::default()
        });
        assert_eq!(app.restore_rooms().unwrap(), 1);
        let room = app.room("numeric").unwrap();
        let (tx, mut rx) = app.outbound.channel();
        room.send(Command::Connect { conn: 7, tx }).unwrap();
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                let message: Value = serde_json::from_str(&rx.recv().await.unwrap()).unwrap();
                if message["type"] == "room" {
                    break;
                }
            }
        })
        .await
        .unwrap();
        let response = room_info(State(app.clone()), Path("numeric".into())).await;
        assert_eq!(response.status(), StatusCode::INSUFFICIENT_STORAGE);
        let body = axum::body::to_bytes(response.into_body(), 2048).await.unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&body).unwrap(),
            json!({"code":"resource_capacity","reason":{"code":"capacity","resource":"room_version","limit":command_protocol::MAX_COMMAND_SEQUENCE}})
        );
        room.send(Command::Disconnect { conn: 7 }).unwrap();
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if app.rooms.lock().is_empty() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(
            app.open_rooms(),
            1,
            "preserved unavailable identity still owns its slot"
        );
        assert_eq!(
            room_info(State(app.clone()), Path("numeric".into())).await.status(),
            StatusCode::INSUFFICIENT_STORAGE
        );
        let saved: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(
            saved["commands"]["room_version"],
            command_protocol::MAX_COMMAND_SEQUENCE - 2
        );
        assert!(!path.with_extension("bad").exists());
    }

    #[test]
    fn exhausted_connection_ids_never_reuse_an_existing_connection_identity() {
        let rooms = Rooms::default();
        rooms.next_conn.store(u64::MAX - 1, Ordering::Relaxed);
        assert_eq!(rooms.connection_id(), Some(u64::MAX - 1));
        assert_eq!(rooms.connection_id(), None);
        assert_eq!(rooms.next_conn.load(Ordering::Relaxed), u64::MAX);
    }

    fn saved_lobby(id: &str) -> Value {
        let room = Room::<mighty::Mighty>::new(
            id.into(),
            mighty::table::MightySettings::default(),
            Arc::new(RoomEnv::new(Duration::ZERO)),
            room::mighty_bots(),
        );
        serde_json::to_value(room.snapshot()).unwrap()
    }

    async fn assert_preserved_507(app: &AppState, id: &str, path: &std::path::Path, original: &[u8], reason: Value) {
        assert_eq!(app.restore_rooms().unwrap(), 0);
        assert_eq!(app.restore_rooms().unwrap(), 0);
        assert!(app.rooms.lock().is_empty(), "no phantom actor");
        let response = room_info(State(app.clone()), Path(id.to_owned())).await;
        assert_eq!(response.status(), StatusCode::INSUFFICIENT_STORAGE);
        let bytes = axum::body::to_bytes(response.into_body(), 2048).await.unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&bytes).unwrap(),
            json!({"code":"resource_capacity","reason":reason})
        );
        assert_eq!(std::fs::read(path).unwrap(), original);
        assert!(!path.with_extension("bad").exists());
        assert!(app.unavailable_response(id).is_some()); // same branch precedes WS upgrade
    }

    #[tokio::test]
    async fn oversized_restore_is_bounded_preserved_and_reserves_its_room_slot() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("saved.json");
        let original = vec![b'!'; 129]; // cannot parse: metadata admission must win
        std::fs::write(&path, &original).unwrap();
        let app = AppState::new(Config {
            data: Some(dir.path().into()),
            resource_snapshot_bytes: 128,
            max_rooms: 1,
            ..Config::default()
        });
        assert_preserved_507(
            &app,
            "saved",
            &path,
            &original,
            json!({"code":"capacity","resource":"snapshot","limit":128}),
        )
        .await;
        assert_eq!(app.open_rooms(), 1);
        assert!(
            app.create_room::<mighty::Mighty>(Default::default(), room::mighty_bots())
                .is_none()
        );
    }

    #[tokio::test]
    async fn tiny_malformed_seat_profile_is_refused_before_allocating_seats() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("saved.json");
        let mut snapshot = saved_lobby("saved");
        snapshot["settings"]["rules"] = serde_json::to_value(mighty::rules::Rules::web_mighty()).unwrap();
        snapshot["settings"]["rules"]["players"] = json!(usize::MAX);
        let original = serde_json::to_vec(&snapshot).unwrap();
        let app = AppState::new(Config {
            data: Some(dir.path().into()),
            ..Config::default()
        });
        std::fs::write(&path, &original).unwrap();
        assert_preserved_507(&app, "saved", &path, &original, json!({"code":"unsupported_profile"})).await;
    }

    #[tokio::test]
    async fn unknown_native_schema_and_unsafe_rotation_remain_preserved_unavailable() {
        for (field, value, reason) in [
            ("game", json!("future_game"), json!({"code":"unsupported_profile"})),
            ("format", json!(999), json!({"code":"unsupported_profile"})),
            ("rotation", json!(usize::MAX), json!({"code":"unreservable_legacy"})),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("saved.json");
            let mut snapshot = saved_lobby("saved");
            snapshot[field] = value;
            let original = serde_json::to_vec(&snapshot).unwrap();
            std::fs::write(&path, &original).unwrap();
            let app = AppState::new(Config {
                data: Some(dir.path().into()),
                ..Config::default()
            });
            assert_preserved_507(&app, "saved", &path, &original, reason).await;
        }
    }

    #[tokio::test]
    async fn bounded_legacy_session_without_delivery_recovery_headroom_is_preserved() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("saved.json");
        let original = serde_json::to_vec(&saved_lobby("saved")).unwrap();
        std::fs::write(&path, &original).unwrap();
        let app = AppState::new(Config {
            data: Some(dir.path().into()),
            outbound_message_bytes: 1024,
            outbound_connection_bytes: 4096,
            outbound_global_bytes: 8192,
            ..Config::default()
        });
        assert_preserved_507(
            &app,
            "saved",
            &path,
            &original,
            json!({"code":"capacity","resource":"session","limit":1024}),
        )
        .await;
    }

    #[tokio::test]
    async fn restore_capacity_defers_files_without_parsing_or_an_unbounded_registry() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("saved.json");
        let original = b"preserve even without parsing at actor capacity";
        std::fs::write(&path, original).unwrap();
        let app = AppState::new(Config {
            data: Some(dir.path().into()),
            max_rooms: 0,
            ..Config::default()
        });
        assert_preserved_507(
            &app,
            "saved",
            &path,
            original,
            json!({"code":"capacity","resource":"rooms","limit":0}),
        )
        .await;
        assert!(app.rooms.unavailable.lock().unwrap().is_empty());
        assert!(app.unavailable_reason("../saved").is_none());
    }

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

    /// A connection asking for hints too often is told; one reacting too
    /// fast is not, its extra reactions dropped. Both refill with time.
    #[tokio::test(start_paused = true)]
    async fn hints_and_reactions_have_their_own_limits() {
        let mut limits = ConnLimits::new();
        let react = ClientMsg::React { text: "굿".into() };
        assert_eq!(limits.verdict(&react), Verdict::Send);
        assert_eq!(limits.verdict(&react), Verdict::Drop);
        tokio::time::advance(Duration::from_millis(700)).await;
        assert_eq!(limits.verdict(&react), Verdict::Send);
        let hints: Vec<_> = (0..5).map(|_| limits.verdict(&ClientMsg::Hint)).collect();
        assert_eq!(hints[..4], [Verdict::Send, Verdict::Send, Verdict::Send, Verdict::Send]);
        assert_eq!(hints[4], Verdict::Refuse(ErrorCode::HintsTooOften.into()));
        tokio::time::advance(Duration::from_secs(5)).await;
        assert_eq!(limits.verdict(&ClientMsg::Hint), Verdict::Send);
        assert_eq!(limits.verdict(&ClientMsg::Start), Verdict::Send);
    }
}
