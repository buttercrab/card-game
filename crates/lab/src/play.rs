//! The card play of a recorded hand replayed with another bot in one seat.

use crate::error::Result;
use crate::record::{Record, outcome, replay};
use crate::stream::{LabUse, Stream, lab, streams};
use crate::table::{Actor, Decision, Phase, Table, advance};
use engine::{Game, Seat, Viewer};
use mighty::rules::Rules;
use mighty::{Action, Mighty, PhaseView};
use mighty_ai::SimpleBot;
use rand_chacha::ChaCha8Rng;
use serde::{Deserialize, Serialize};

/// One card-play decision of a focus seat, compared with the usual bots.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayDecision {
    pub trick_no: usize,
    pub leading: bool,
    pub attacking: bool,
    pub chosen: Action,
    pub hard: Action,
    pub simple: Action,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayResult {
    pub deal: u64,
    pub focus: Seat,
    pub variant: String,
    pub declarer: Seat,
    pub attacking: bool,
    pub base: i64,
    pub payoff: i64,
    pub team_points: u8,
    pub base_team_points: u8,
    /// Decisions where the variant chose otherwise than the recorded bot
    /// would have on the same view.
    pub differing: Vec<PlayDecision>,
}

/// The focus seat's decision `d`, if `base` would have chosen otherwise
/// on the same view and randomness: the two choices and the simple bot's.
fn differing(record: &Record, base: &Actor, focus: Seat, d: &Decision, rng: &mut ChaCha8Rng) -> Option<PlayDecision> {
    let legal = engine::legal_on_turn::<Mighty>(d.state);
    if d.seat != focus || legal.len() == 1 {
        return None;
    }
    let hard = base.act(d.state, focus, &mut d.rng.clone());
    if hard == *d.action {
        return None;
    }
    let view = Mighty::view(d.state, Viewer::Seat(focus));
    let simple = engine::Bot::act(&mut SimpleBot::default(), &view, &legal, rng);
    let PhaseView::Play { trick_no, plays, .. } = &view.phase else {
        return None;
    };
    Some(PlayDecision {
        trick_no: *trick_no,
        leading: plays.is_empty(),
        attacking: record.attacking(focus),
        chosen: d.action.clone(),
        hard,
        simple,
    })
}

/// Replays the card play of `record` with `variant` in seat `focus` and
/// `base` everywhere else.
pub fn play_variant(
    rules: &Rules,
    record: &Record,
    base: &Actor,
    focus: Seat,
    variant: (&str, &Actor),
) -> Result<PlayResult> {
    let mut state = replay(rules, record, record.play_at)?;
    let table = Table {
        all: base,
        focus: Some((focus, Phase::Play, variant.1)),
    };
    let mut rngs = streams(record.deal, Stream::Play, rules.players);
    let mut found = Vec::new();
    let mut compare = lab(record.deal, LabUse::Compare(focus));
    advance(
        record.deal,
        &mut state,
        &table,
        &mut rngs,
        &mut Vec::new(),
        Phase::Play,
        &mut |d| found.extend(differing(record, base, focus, &d, &mut compare)),
    )?;
    let done = outcome(record.deal, &state)?;
    Ok(PlayResult {
        deal: record.deal,
        focus,
        variant: variant.0.to_string(),
        declarer: record.declarer,
        attacking: record.attacking(focus),
        base: record.payoffs[focus],
        payoff: done.payoffs[focus],
        team_points: done.team_points,
        base_team_points: record.team_points,
        differing: found,
    })
}

/// Replays `record` to the start of trick `trick` (0-based), then plays the
/// rest twice on the same randomness: `base` in every seat, and `variant`
/// in seat `focus` instead. Cheap, and with little luck left in the hand,
/// precise about how a bot plays the last tricks. `base` is the replayed
/// base payoff, not the recorded one.
pub fn play_from(
    rules: &Rules,
    record: &Record,
    base: &Actor,
    focus: Seat,
    variant: (&str, &Actor),
    trick: usize,
) -> Result<PlayResult> {
    let seats = rules.players;
    let start = replay(rules, record, record.play_at + trick * seats)?;
    let finish = |actor: &Actor, found: &mut Vec<PlayDecision>, watch: bool| {
        let mut state = start.clone();
        let table = Table {
            all: base,
            focus: Some((focus, Phase::Play, actor)),
        };
        let mut rngs = streams(record.deal, Stream::FromTrick(trick), seats);
        let mut compare = lab(record.deal, LabUse::Compare(focus));
        advance(
            record.deal,
            &mut state,
            &table,
            &mut rngs,
            &mut Vec::new(),
            Phase::Play,
            &mut |d| {
                if watch {
                    found.extend(differing(record, base, focus, &d, &mut compare));
                }
            },
        )?;
        outcome(record.deal, &state)
    };
    let mut found = Vec::new();
    let was = finish(base, &mut Vec::new(), false)?;
    let now = finish(variant.1, &mut found, true)?;
    Ok(PlayResult {
        deal: record.deal,
        focus,
        variant: variant.0.to_string(),
        declarer: record.declarer,
        attacking: record.attacking(focus),
        base: was.payoffs[focus],
        payoff: now.payoffs[focus],
        team_points: now.team_points,
        base_team_points: was.team_points,
        differing: found,
    })
}
