//! What the web client knows before it talks to a table: the presets with
//! their rules. [`crate::codegen`] writes it into the client's build as
//! `generated/catalog.ts`, so the client never keeps copies of its own.

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

/// Everything the client takes from the server at build time.
#[derive(Debug, Clone, Serialize, TS)]
pub struct Catalog {
    /// The protocol the client is built for; see [`crate::protocol::version`].
    pub protocol: String,
    /// In the order players pick them.
    pub presets: Vec<PresetInfo>,
    pub default_preset: Preset,
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
