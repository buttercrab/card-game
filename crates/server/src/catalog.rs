//! What the web client knows before it talks to a table: the presets with
//! their rules, the bot levels, the table's choices and limits.
//! [`crate::codegen`] writes it into the client's build as
//! `generated/catalog.ts`, so the client never keeps copies of its own.

use crate::room::{NAME_MAX, REACTIONS, TURN_LIMITS};
use engine::{Level, Table};
use mighty::Mighty;
use mighty::rules::{Preset, Rules};
use mighty::table::PresetInfo;
use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, TS)]
pub struct BotLevelInfo {
    pub id: Level,
    /// Its name at the table.
    pub label: String,
}

/// Everything the client takes from the server at build time.
#[derive(Debug, Clone, Serialize, TS)]
pub struct Catalog {
    /// The protocol the client is built for; see [`crate::protocol::version`].
    pub protocol: String,
    /// In the order players pick them.
    pub presets: Vec<PresetInfo>,
    pub default_preset: Preset,
    /// What the server assumes for a rule that saved rules leave out (rules
    /// saved before it existed): a set kept on a device fills its gaps
    /// from these, as the server would.
    pub rule_defaults: Rules,
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
    /// Where 딜미스 comes first, how long the first bid waits after the
    /// deal, in milliseconds.
    pub first_bid_grace_ms: u64,
    /// A table with nobody connected closes after this many minutes.
    pub idle_minutes: u64,
}

pub fn catalog() -> Catalog {
    let mighty = Mighty::catalog();
    Catalog {
        protocol: crate::protocol::version().to_string(),
        presets: mighty.presets,
        default_preset: mighty.default_preset,
        rule_defaults: mighty.rule_defaults,
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
        first_bid_grace_ms: mighty.first_bid_grace_ms,
        idle_minutes: crate::IDLE_MINUTES,
    }
}
