use crate::*;
use engine::{Bot, Decision, HandReport, Level, Table, TableBots, TableError};
use std::time::Duration;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PokerSettings {
    pub rules: PokerRules,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct PokerPreset {
    pub id: String,
    pub name: String,
    pub rules: PokerRules,
}
#[derive(Debug, Clone, Serialize, TS)]
pub struct PokerCatalog {
    pub id: String,
    pub name: String,
    pub presets: Vec<PokerPreset>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PokerSummary {
    pub dealer: Seat,
    pub board: Vec<PokerCard>,
    pub payoffs: Vec<i64>,
    pub pots: Vec<PokerPot>,
}
#[derive(Debug, Clone, Serialize, TS)]
pub struct PokerNotes {
    pub to_call: u16,
    pub min_raise_to: Option<u16>,
    pub independent_hand: bool,
}
impl HandReport for Poker {
    type Summary = PokerSummary;
    type Notes = PokerNotes;
    fn summary(s: &PokerState) -> Option<PokerSummary> {
        Self::payoffs(s).map(|payoffs| PokerSummary {
            dealer: s.dealer,
            board: Self::view(s, Viewer::Spectator).board,
            payoffs,
            pots: s.pots.clone(),
        })
    }
    fn reseat(summary: &mut PokerSummary, order: &[usize]) {
        summary.dealer = order[summary.dealer];
        let old = summary.payoffs.clone();
        for (seat, payoff) in old.into_iter().enumerate() {
            summary.payoffs[order[seat]] = payoff;
        }
        for pot in &mut summary.pots {
            for seat in &mut pot.winners {
                *seat = order[*seat]
            }
        }
    }
    fn outcome(s: &PokerState) -> &'static str {
        if s.showdown { "showdown" } else { "folds" }
    }
    fn notes(s: &PokerState, seat: Option<Seat>, _legal: &[PokerAction]) -> PokerNotes {
        let actor = seat.filter(|seat| s.actor == Some(*seat));
        PokerNotes {
            to_call: actor.map_or(0, |seat| s.call_cost(seat)),
            min_raise_to: actor.and_then(|seat| s.min_raise_to(seat)),
            independent_hand: true,
        }
    }
}
impl Table for Poker {
    type Settings = PokerSettings;
    type Catalog = PokerCatalog;
    type Examples = Vec<PokerSummary>;
    fn new_table(preset: Option<&str>, rules: Option<PokerRules>) -> Result<PokerSettings, TableError<PokerError>> {
        if preset.is_some_and(|id| id != "holdem") {
            return Err(TableError::UnknownPreset(preset.unwrap().into()));
        }
        let rules = rules.unwrap_or_default();
        Self::validate(&rules).map_err(TableError::Rules)?;
        Ok(PokerSettings { rules })
    }
    fn freeze(_settings: &mut PokerSettings) {}
    fn table_rules(settings: &PokerSettings) -> PokerRules {
        settings.rules.clone()
    }
    fn preset_id(_settings: &PokerSettings) -> &'static str {
        "holdem"
    }
    fn customized(settings: &PokerSettings) -> bool {
        settings.rules != PokerRules::default()
    }
    fn hand_options(settings: &PokerSettings, hand: u32, _last: Option<&PokerSummary>, shift: usize) -> PokerOptions {
        PokerOptions {
            rules: settings.rules.clone(),
            dealer: (hand as usize + shift) % settings.rules.players,
            starting_stacks: Vec::new(),
        }
    }
    fn grace(_s: &PokerState, _action: &PokerAction) -> Duration {
        Duration::ZERO
    }
    fn long_decision(_legal: &[PokerAction]) -> bool {
        false
    }
    fn catalog() -> PokerCatalog {
        PokerCatalog {
            id: Self::ID.into(),
            name: Self::NAME.into(),
            presets: Self::presets()
                .into_iter()
                .map(|p| PokerPreset {
                    id: p.id.into(),
                    name: p.name.into(),
                    rules: p.rules,
                })
                .collect(),
        }
    }
    fn examples(_rules: &PokerRules) -> Vec<PokerSummary> {
        Vec::new()
    }
}
/// Basic legal-action policy only; levels currently share the same modest policy.
#[derive(Debug, Clone, Copy, Default)]
pub struct PokerBots;
struct PlayChipBot;
impl Bot<Poker> for PlayChipBot {
    fn act(&mut self, _view: &PokerView, legal: &[PokerAction], _rng: &mut dyn RngCore) -> PokerAction {
        legal
            .iter()
            .find(|a| matches!(a, PokerAction::Check))
            .or_else(|| legal.iter().find(|a| matches!(a, PokerAction::Call)))
            .or_else(|| legal.first())
            .expect("a betting actor has legal choices")
            .clone()
    }
}
impl TableBots<Poker> for PokerBots {
    fn bot(&self, _level: Level, _temper: usize, _think: Duration, _threads: usize) -> Box<dyn Bot<Poker> + Send> {
        Box::new(PlayChipBot)
    }
    fn off_turn(&self, _level: Level, _seat: Seat, _view: &PokerView, _legal: &[PokerAction]) -> Option<PokerAction> {
        None
    }
    fn decision(&self, _view: &PokerView, legal: &[PokerAction]) -> Decision {
        if legal.len() <= 1 {
            Decision::Obvious
        } else {
            Decision::Bid
        }
    }
}
