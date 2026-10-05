//! What the web client knows before it talks to a table: the presets with
//! their rules, the bot levels, the table's choices and limits.
//! [`crate::codegen`] writes it into the client's build as
//! `generated/catalog.ts`, so the client never keeps copies of its own.

use crate::room::{NAME_MAX, REACTIONS, TURN_LIMITS};
use crate::session::{BotLevel, FIRST_BID_GRACE};
use mighty::rules::{Preset, Rules};
use serde::Serialize;
use ts_rs::TS;

/// The presets in the order players pick them from: 기본 first, then the
/// one with two jokers, then the rest.
pub const PRESET_ORDER: [Preset; 9] = [
    Preset::Default,
    Preset::Gshs,
    Preset::Ddshs,
    Preset::Dshs,
    Preset::Kmla,
    Preset::Gsa,
    Preset::Skku,
    Preset::Sshs,
    Preset::Yonsei,
];

/// The table a new table plays unless its maker picks another.
pub const DEFAULT_PRESET: Preset = Preset::Default;

#[derive(Debug, Clone, Serialize, TS)]
pub struct PresetInfo {
    pub id: Preset,
    /// The short name players know it by.
    pub title: String,
    /// What sets it apart, where the title does not say.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub note: Option<String>,
    pub rules: Rules,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct BotLevelInfo {
    pub id: BotLevel,
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
    /// From weakest to strongest.
    pub bot_levels: Vec<BotLevelInfo>,
    /// The level a bot sits down at unless asked for another.
    pub default_bot_level: BotLevel,
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
    Catalog {
        protocol: crate::protocol::version().to_string(),
        presets: PRESET_ORDER
            .iter()
            .map(|&p| PresetInfo {
                id: p,
                title: p.title().to_string(),
                note: p.note().map(str::to_string),
                rules: p.rules(),
            })
            .collect(),
        default_preset: DEFAULT_PRESET,
        bot_levels: BotLevel::ALL
            .iter()
            .map(|&id| BotLevelInfo {
                id,
                label: id.label().to_string(),
            })
            .collect(),
        default_bot_level: BotLevel::default(),
        turn_limits: TURN_LIMITS.to_vec(),
        reactions: REACTIONS.iter().map(|r| r.to_string()).collect(),
        name_max: NAME_MAX,
        report_max: crate::REPORT_MAX,
        report_days: crate::REPORT_DAYS,
        first_bid_grace_ms: FIRST_BID_GRACE.as_millis() as u64,
        idle_minutes: crate::IDLE_MINUTES,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_preset_is_offered_once() {
        let mut order = PRESET_ORDER.to_vec();
        order.sort_by_key(|p| p.name());
        let mut all = Preset::ALL.to_vec();
        all.sort_by_key(|p| p.name());
        assert_eq!(order, all);
    }
}
