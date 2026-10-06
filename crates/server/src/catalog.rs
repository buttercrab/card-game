//! What the web client knows before it talks to a table: the games, the bot
//! levels, the table's choices and limits. [`crate::codegen`] writes it
//! into the client's build as `generated/catalog.ts`, and each game's own
//! catalog ([`engine::Table::Catalog`]: its presets with their rules, and
//! the like) as `generated/<game>/catalog.ts`, so the client never keeps
//! copies of its own.

use crate::game::GameCatalog;
use crate::room::{NAME_MAX, REACTIONS, TURN_LIMITS};
use engine::Level;
use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, TS)]
pub struct BotLevelInfo {
    pub id: Level,
    /// Its name at the table.
    pub label: String,
}

/// A game the server offers.
#[derive(Debug, Clone, Serialize, TS)]
pub struct GameListing {
    /// Its id, in routes and in the room message's `game`.
    pub id: String,
    /// For people: `마이티`.
    pub name: String,
}

/// Everything the client takes from the server at build time, whatever the
/// game.
#[derive(Debug, Clone, Serialize, TS)]
pub struct Catalog {
    /// The protocol the client is built for; see [`crate::protocol::version`].
    pub protocol: String,
    /// The games, the first being what the routes without a game id mean.
    pub games: Vec<GameListing>,
    /// From weakest to strongest.
    pub bot_levels: Vec<BotLevelInfo>,
    /// The level a bot sits down at unless asked for another.
    pub default_bot_level: Level,
    /// The turn limits a table may choose, in seconds; 0 is none.
    pub turn_limits: Vec<u32>,
    /// The quick reactions a seat may send; anything else is refused.
    pub reactions: Vec<String>,
    /// The longest name a seat takes, in characters.
    pub name_max: usize,
    /// The longest problem report kept, in characters.
    pub report_max: usize,
    /// How long reports and new client errors are kept, in days.
    pub report_days: u64,
    /// A table with nobody connected closes after this many minutes.
    pub idle_minutes: u64,
}

pub fn catalog() -> Catalog {
    Catalog {
        protocol: crate::protocol::version().to_string(),
        games: GameCatalog::standard()
            .games()
            .map(|g| GameListing {
                id: g.id().to_string(),
                name: g.name().to_string(),
            })
            .collect(),
        bot_levels: Level::ALL
            .iter()
            .map(|&id| BotLevelInfo {
                id,
                label: id.label().to_string(),
            })
            .collect(),
        default_bot_level: Level::default(),
        turn_limits: TURN_LIMITS.to_vec(),
        reactions: REACTIONS.iter().map(|r| r.to_string()).collect(),
        name_max: NAME_MAX,
        report_max: crate::REPORT_MAX,
        report_days: crate::REPORT_DAYS,
        idle_minutes: crate::IDLE_MINUTES,
    }
}

/// The site's catalog with every game's, as `server --dump-catalog` prints
/// it.
pub fn everything() -> serde_json::Value {
    let games: serde_json::Map<String, serde_json::Value> = GameCatalog::standard()
        .games()
        .map(|g| (g.id().to_string(), g.catalog()))
        .collect();
    serde_json::json!({ "site": catalog(), "games": games })
}
