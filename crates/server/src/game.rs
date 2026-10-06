//! The games this server offers, by id ([`GameCatalog`]).
//!
//! A room runs one game, typed ([`crate::room::Room`] over a
//! [`ServerGame`]); everything that picks a game by id (the game-scoped
//! routes, restoring saved tables, a bot worker's jobs) goes through the
//! catalog, which holds each game without its types ([`GameEntry`]).
//! Registering a game is one line in [`GameCatalog::standard`]: its rules
//! crate implements [`engine::Table`] and [`engine::HandReport`], its bots
//! crate [`engine::TableBots`].

use crate::AppState;
use crate::protocol::{CreateRoom, ErrorCode, ServerError};
use crate::room::Room;
use axum::http::StatusCode;
use engine::{HandReport, Level, Table, TableBots, TableError};
use rand::SeedableRng;
use rand::rngs::StdRng;
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;

/// A game the server's tables can play: its table rules and hand reports
/// ([`Table`], [`HandReport`]), with everything [`GameInfo`] gives.
pub trait ServerGame: Table + HandReport {}

impl<G: Table + HandReport> ServerGame for G {}

/// How many seats a table with `settings` has.
pub fn seats<G: ServerGame>(settings: &G::Settings) -> usize {
    G::seats(&G::table_rules(settings))
}

/// Why `settings` cannot be played, as a refusal.
pub fn validate<G: ServerGame>(settings: &G::Settings) -> Result<(), ServerError> {
    G::validate(&G::table_rules(settings)).map_err(|e| ServerError::rules(&e))
}

/// One game the server offers, without its types: everything that names a
/// game by id goes through this.
pub trait GameEntry: Send + Sync {
    fn id(&self) -> &'static str;

    /// For people: `마이티`.
    fn name(&self) -> &'static str;

    /// The presets' ids, in the game's own order.
    fn presets(&self) -> Vec<&'static str>;

    /// A preset's full rules, as JSON.
    fn preset_rules(&self, id: &str) -> Option<Value>;

    /// What the web client knows of the game before a table opens
    /// ([`Table::Catalog`]).
    fn catalog(&self) -> Value;

    /// [`GameEntry::catalog`] as pretty JSON, its fields in their order.
    fn catalog_json(&self) -> String;

    /// The TypeScript name of the catalog's type, in `protocol.ts`.
    fn catalog_type(&self) -> String;

    /// The rulebook's examples under the rules in `body`.
    fn examples(&self, body: &[u8]) -> Result<Value, ServerError>;

    /// Opens a table as `body` ([`CreateRoom`]) asks, returning its id.
    fn create(&self, app: &AppState, body: &[u8]) -> Result<String, (StatusCode, ServerError)>;

    /// Reopens a table saved as `snapshot` ([`crate::room::SnapshotV2`] or
    /// the first format), returning its id.
    fn restore(&self, app: &AppState, snapshot: Value) -> Result<String, String>;

    /// A bot's move, as a bot worker makes it: `view` and `legal` are the
    /// game's own, as JSON.
    fn think(&self, bot: Think, view: Value, legal: Value) -> Result<Value, String>;
}

/// What a bot worker is asked to think about, apart from the position.
#[derive(Debug, Clone, Copy)]
pub struct Think {
    pub level: Level,
    pub temper: usize,
    pub seed: u64,
    pub think: Duration,
    pub threads: usize,
}

/// `G` with its bots, as a [`GameEntry`].
struct Entry<G: ServerGame> {
    bots: Arc<dyn TableBots<G>>,
}

impl<G: ServerGame> GameEntry for Entry<G> {
    fn id(&self) -> &'static str {
        G::ID
    }

    fn name(&self) -> &'static str {
        G::NAME
    }

    fn presets(&self) -> Vec<&'static str> {
        G::presets().into_iter().map(|p| p.id).collect()
    }

    fn preset_rules(&self, id: &str) -> Option<Value> {
        engine::info::preset::<G>(id).map(|rules| serde_json::to_value(rules).expect("rules serialize"))
    }

    fn catalog(&self) -> Value {
        serde_json::to_value(G::catalog()).expect("a catalog serializes")
    }

    fn catalog_json(&self) -> String {
        serde_json::to_string_pretty(&G::catalog()).expect("a catalog serializes")
    }

    fn catalog_type(&self) -> String {
        <G::Catalog as ts_rs::TS>::ident(&ts_rs::Config::new())
    }

    fn examples(&self, body: &[u8]) -> Result<Value, ServerError> {
        let rules: G::Rules =
            serde_json::from_slice(body).map_err(|e| ServerError::with_detail(ErrorCode::BadMessage, e))?;
        G::validate(&rules).map_err(|e| ServerError::rules(&e))?;
        Ok(serde_json::to_value(G::examples(&rules)).expect("examples serialize"))
    }

    fn create(&self, app: &AppState, body: &[u8]) -> Result<String, (StatusCode, ServerError)> {
        let bad = |e: ServerError| (StatusCode::BAD_REQUEST, e);
        let request: CreateRoom<String, G::Rules> = crate::parse_body(body).map_err(bad)?;
        let settings = G::new_table(request.preset.as_deref(), request.rules).map_err(|e| match e {
            TableError::UnknownPreset(id) => bad(ServerError::with_detail(ErrorCode::UnknownPreset, id)),
            TableError::Rules(e) => bad(ServerError::rules(&e)),
        })?;
        app.create_room::<G>(settings, self.bots.clone()).ok_or_else(|| {
            tracing::warn!(max = app.config().max_rooms, "refused a table: too many are open");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                ServerError::new(ErrorCode::TooManyTables),
            )
        })
    }

    fn restore(&self, app: &AppState, snapshot: Value) -> Result<String, String> {
        let room = Room::<G>::restore(snapshot, app.room_env(), self.bots.clone())?;
        Ok(app.open_restored(room))
    }

    fn think(&self, bot: Think, view: Value, legal: Value) -> Result<Value, String> {
        let view: G::View = serde_json::from_value(view).map_err(|e| format!("unreadable view: {e}"))?;
        let legal: Vec<G::Action> =
            serde_json::from_value(legal).map_err(|e| format!("unreadable legal moves: {e}"))?;
        if legal.is_empty() {
            return Err("no legal moves".into());
        }
        let action = self.bots.bot(bot.level, bot.temper, bot.think, bot.threads).act(
            &view,
            &legal,
            &mut StdRng::seed_from_u64(bot.seed),
        );
        serde_json::to_value(action).map_err(|e| e.to_string())
    }
}

/// The games a server offers, by id. The first registered is the one the
/// routes from before games had ids (`/api/rooms`, `/api/presets`, ...)
/// mean.
#[derive(Clone, Default)]
pub struct GameCatalog {
    games: Vec<Arc<dyn GameEntry>>,
}

impl GameCatalog {
    /// Every game this build offers.
    pub fn standard() -> GameCatalog {
        GameCatalog::default().with::<mighty::Mighty>(mighty_ai::MightyBots)
    }

    /// Adds `G`, played by `bots`. Two games with one id would make ids
    /// ambiguous, so that panics.
    pub fn with<G: ServerGame>(mut self, bots: impl TableBots<G>) -> GameCatalog {
        assert!(self.get(G::ID).is_none(), "game `{}` registered twice", G::ID);
        self.games.push(Arc::new(Entry::<G> { bots: Arc::new(bots) }));
        self
    }

    pub fn get(&self, id: &str) -> Option<&dyn GameEntry> {
        self.games.iter().find(|g| g.id() == id).map(|g| g.as_ref())
    }

    /// The game the routes without a game id mean.
    pub fn default_game(&self) -> &dyn GameEntry {
        self.games.first().expect("a server offers at least one game").as_ref()
    }

    /// Every game, in the order registered.
    pub fn games(&self) -> impl Iterator<Item = &dyn GameEntry> {
        self.games.iter().map(|g| g.as_ref())
    }
}

impl std::fmt::Debug for GameCatalog {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_list().entries(self.games().map(|g| g.id())).finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mighty_is_offered_first() {
        let games = GameCatalog::standard();
        assert_eq!(games.default_game().id(), "mighty");
        assert_eq!(games.get("mighty").map(|g| g.name()), Some("마이티"));
        assert!(games.get("poker").is_none());
        assert_eq!(games.default_game().presets().len(), mighty::rules::Preset::ALL.len());
    }

    #[test]
    #[should_panic(expected = "registered twice")]
    fn ids_are_unique() {
        let _ = GameCatalog::standard().with::<mighty::Mighty>(mighty_ai::MightyBots);
    }
}
