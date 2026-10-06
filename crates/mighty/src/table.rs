//! Mighty at the server's tables ([`engine::table`]): a table's settings
//! (a preset, pinned, and the table's own rules), how each hand of a
//! session is set up, the notes a seat's table shows, a finished hand in
//! brief, and the catalog the web client is built with. The bots are in
//! `mighty-ai`.

use crate::card::Card;
use crate::explain::Refusal;
use crate::rules::{Contract, InvalidRules, MisdealWindow, Preset, Rules};
use crate::{Action, HandSummary, Mighty, State};
use engine::{HandReport, Seat, Table, TableError};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use ts_rs::TS;

/// Where misdeals come before any bid, the first bid waits this long after
/// the deal, so a fast bid never beats a 딜미스 to the table.
pub const FIRST_BID_GRACE: Duration = Duration::from_secs(2);

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

/// The preset a new table plays unless its maker picks another.
pub const DEFAULT_PRESET: Preset = Preset::Default;

/// What a Mighty table is set to play.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct MightySettings {
    pub preset: Preset,
    /// The table's own rules, when its players changed the preset's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub rules: Option<Rules>,
    /// The preset's rules as they were when the table chose it; see
    /// [`Table::freeze`]. Without it, the preset's rules today.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub preset_rules: Option<Rules>,
}

impl MightySettings {
    pub fn new(preset: Preset) -> MightySettings {
        MightySettings {
            preset,
            rules: None,
            preset_rules: None,
        }
    }

    pub fn rules(&self) -> Rules {
        self.rules.clone().unwrap_or_else(|| self.base())
    }

    /// The preset's rules, as pinned for this table.
    fn base(&self) -> Rules {
        self.preset_rules.clone().unwrap_or_else(|| self.preset.rules())
    }
}

impl Default for MightySettings {
    fn default() -> MightySettings {
        MightySettings::new(Preset::Gshs)
    }
}

/// What a Mighty table says beyond the view, on the seat's turn.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
pub struct MightyNotes {
    /// In play: each card in hand that may not be played, with why.
    pub unplayable: Vec<Unplayable>,
    /// In the exchange: the contract each trump change or raise sets.
    pub contracts: Vec<ContractChange>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
pub struct Unplayable {
    pub card: Card,
    pub why: Refusal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ContractChange {
    pub action: Action,
    pub contract: Contract,
}

/// A preset as the web client lists it.
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

/// What the web client knows of Mighty before any table opens.
#[derive(Debug, Clone, Serialize, TS)]
pub struct MightyCatalog {
    /// In the order players pick them.
    pub presets: Vec<PresetInfo>,
    pub default_preset: Preset,
    /// What the server assumes for a rule that saved rules leave out (rules
    /// saved before it existed): a set kept on a device fills its gaps
    /// from these, as the server would.
    pub rule_defaults: Rules,
    /// Where 딜미스 comes first, how long the first bid waits after the
    /// deal, in milliseconds.
    pub first_bid_grace_ms: u64,
}

impl Table for Mighty {
    type Settings = MightySettings;
    type Catalog = MightyCatalog;
    type Examples = crate::score::Examples;

    fn new_table(preset: Option<&str>, rules: Option<Rules>) -> Result<MightySettings, TableError<InvalidRules>> {
        let preset = match preset {
            None => DEFAULT_PRESET,
            Some(id) => id.parse().map_err(|_| TableError::UnknownPreset(id.to_string()))?,
        };
        let mut settings = MightySettings::new(preset);
        Mighty::freeze(&mut settings);
        // Rules no different from the preset's are the preset's.
        settings.rules = rules.filter(|r| Some(r) != settings.preset_rules.as_ref());
        settings.rules().validate().map_err(TableError::Rules)?;
        Ok(settings)
    }

    fn freeze(settings: &mut MightySettings) {
        if settings.preset_rules.is_none() {
            settings.preset_rules = Some(settings.preset.rules());
        }
    }

    fn table_rules(settings: &MightySettings) -> Rules {
        settings.rules()
    }

    fn preset_id(settings: &MightySettings) -> &'static str {
        settings.preset.name()
    }

    fn customized(settings: &MightySettings) -> bool {
        settings.rules.as_ref().is_some_and(|r| *r != settings.base())
    }

    /// The first bidder moves one seat to the left each hand, unless the
    /// rules hand the deal to last hand's friend or declarer.
    fn hand_options(settings: &MightySettings, hand: u32, last: Option<&HandSummary>, shift: usize) -> crate::Options {
        let rules = settings.rules();
        let n = rules.players as u32;
        let first_bidder = rules.first_bidder(hand % n + (shift as u32) % n, last);
        crate::Options { rules, first_bidder }
    }

    fn grace(state: &State, action: &Action) -> Duration {
        let first_bid = matches!(action, Action::Bid(_)) && state.before_first_bid();
        if first_bid && state.rules().misdeal.window == MisdealWindow::BeforeFirstBid {
            FIRST_BID_GRACE
        } else {
            Duration::ZERO
        }
    }

    /// The exchange (discards, a trump change) and the friend call.
    fn long_decision(legal: &[Action]) -> bool {
        legal
            .iter()
            .any(|a| matches!(a, Action::Discard(_) | Action::CallFriend(_)))
    }

    fn catalog() -> MightyCatalog {
        MightyCatalog {
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
            rule_defaults: Rules::web_mighty(),
            first_bid_grace_ms: FIRST_BID_GRACE.as_millis() as u64,
        }
    }

    fn examples(rules: &Rules) -> crate::score::Examples {
        crate::score::Examples::new(rules)
    }
}

impl HandReport for Mighty {
    type Summary = HandSummary;
    type Notes = MightyNotes;

    fn summary(state: &State) -> Option<HandSummary> {
        state.summary()
    }

    fn reseat(summary: &mut HandSummary, new_seat: &[usize]) {
        summary.declarer = new_seat.get(summary.declarer).copied().unwrap_or(summary.declarer);
        summary.friend = summary.friend.map(|s| new_seat.get(s).copied().unwrap_or(s));
    }

    fn outcome(state: &State) -> &'static str {
        match state.summary() {
            Some(s) if s.made => "made",
            Some(_) => "failed",
            None => "none",
        }
    }

    fn notes(state: &State, seat: Option<Seat>, legal: &[Action]) -> MightyNotes {
        if seat.is_none() || legal.is_empty() {
            return MightyNotes::default();
        }
        MightyNotes {
            unplayable: state
                .unplayable()
                .into_iter()
                .map(|(card, why)| Unplayable { card, why })
                .collect(),
            contracts: legal
                .iter()
                .filter_map(|action| {
                    let contract = state.contract_after(action)?;
                    Some(ContractChange {
                        action: action.clone(),
                        contract,
                    })
                })
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{PhaseView, testing};
    use engine::{Game, Viewer};
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    /// On every turn the notes say what the table would otherwise work out
    /// for itself: every card in hand is either played or explained, and
    /// every contract change or raise says what it sets. Others get none.
    #[test]
    fn notes_explain_every_unplayable_card_and_contract_change() {
        let (mut explained, mut changes) = (0, 0);
        for (seed, preset) in [Preset::Default, Preset::Gshs, Preset::Skku, Preset::Yonsei]
            .into_iter()
            .cycle()
            .take(24)
            .enumerate()
        {
            let settings = MightySettings::new(preset);
            let options = Mighty::hand_options(&settings, 0, None, 0);
            let mut rng = StdRng::seed_from_u64(seed as u64);
            testing::play_hand(&options, &mut rng, &mut testing::random, &mut |state, seat| {
                let legal = Mighty::legal_actions(state, seat);
                let notes = Mighty::notes(state, Some(seat), &legal);
                let other = (seat + 1) % 5;
                assert_eq!(Mighty::notes(state, Some(other), &[]), MightyNotes::default());
                let view = Mighty::view(state, Viewer::Seat(seat));
                if let PhaseView::Play { .. } = view.phase {
                    for card in &view.hand {
                        let playable = legal
                            .iter()
                            .any(|a| matches!(a, Action::Play { card: c, .. } if c == card));
                        let refused = notes.unplayable.iter().any(|u| u.card == *card);
                        assert!(playable != refused, "{card} is either played or explained");
                    }
                    explained += notes.unplayable.len();
                }
                for a in &legal {
                    let change = notes.contracts.iter().find(|c| c.action == *a);
                    match a {
                        Action::ChangeTrump(trump) => {
                            let c = change.expect("a trump change says what it sets");
                            assert_eq!(c.contract.trump, *trump);
                            changes += 1;
                        }
                        Action::Raise(contract) => assert_eq!(change.unwrap().contract, *contract),
                        _ => assert!(change.is_none()),
                    }
                }
                true
            });
        }
        assert!(explained > 0 && changes > 0, "{explained} {changes}");
    }

    /// A table pins its preset, keeps rules only when they differ from it,
    /// and refuses an unknown preset and unplayable rules.
    #[test]
    fn new_tables_pin_their_preset_and_check_their_rules() {
        let settings = Mighty::new_table(None, None).unwrap();
        assert_eq!(settings.preset, DEFAULT_PRESET);
        assert_eq!(settings.preset_rules, Some(DEFAULT_PRESET.rules()));
        assert!(!Mighty::customized(&settings));
        let same = Mighty::new_table(Some("gshs"), Some(Preset::Gshs.rules())).unwrap();
        assert_eq!(same.rules, None, "the preset's own rules are no change");
        let mut rules = Preset::Gshs.rules();
        rules.bidding.min = 15;
        let own = Mighty::new_table(Some("gshs"), Some(rules.clone())).unwrap();
        assert!(Mighty::customized(&own));
        assert_eq!(Mighty::table_rules(&own), rules);
        rules.bidding.min = 30;
        assert!(matches!(
            Mighty::new_table(Some("gshs"), Some(rules)),
            Err(TableError::Rules(InvalidRules::EmptyBidRange))
        ));
        assert_eq!(
            Mighty::new_table(Some("nope"), None),
            Err(TableError::UnknownPreset("nope".into()))
        );
    }

    #[test]
    fn every_preset_is_offered_once() {
        let mut order = PRESET_ORDER.to_vec();
        order.sort_by_key(|p| p.name());
        let mut all = Preset::ALL.to_vec();
        all.sort_by_key(|p| p.name());
        assert_eq!(order, all);
    }

    /// Rules saved without an option read it as `rule_defaults` has it,
    /// so the client filling gaps from them agrees with the server.
    #[test]
    fn rule_defaults_are_what_the_server_assumes() {
        let defaults = serde_json::to_value(Mighty::catalog().rule_defaults).unwrap();
        let mut saved = serde_json::to_value(Preset::Gshs.rules()).unwrap();
        let optional = [
            "/lowest_rank",
            "/extra_cards",
            "/joker_lead",
            "/scoring",
            "/reveal_discards",
            "/next_dealer",
            "/misdeal/all_points",
            "/misdeal/window",
            "/misdeal/declarer",
            "/misdeal/caller_deals",
            "/bidding/change_to_no_trump_cost",
            "/bidding/pass_is_final",
            "/bidding/last_chance_min",
            "/bidding/raise_on_exchange",
            "/policy/release_with_mighty",
        ];
        for path in optional {
            let (parent, key) = path.rsplit_once('/').unwrap();
            let parent = if parent.is_empty() {
                &mut saved
            } else {
                saved.pointer_mut(parent).unwrap()
            };
            parent.as_object_mut().unwrap().remove(key).unwrap();
        }
        let read = serde_json::to_value(serde_json::from_value::<Rules>(saved).unwrap()).unwrap();
        for path in optional {
            assert_eq!(read.pointer(path), defaults.pointer(path), "{path}");
        }
    }
}
