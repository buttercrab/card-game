//! Plays in recorded hands that look wasteful in hindsight, counted: for
//! finding blind spots in the rules the bots share.

use crate::error::{LabError, Result};
use crate::hindsight::{Flag, flags};
use crate::record::{Record, replay};
use engine::{Game, Turn, Viewer};
use mighty::rules::Rules;
use mighty::{Action, Mighty, PhaseView};
use serde::{Deserialize, Serialize};

/// The hindsight flags ([`Flag`]) of one hand's card play, counted.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Audit {
    pub deal: u64,
    /// Joker calls, and those whose joker the caller held, lay in the
    /// discards, was already played, or sat with the caller's own side.
    pub joker_calls: u32,
    pub call_own_hand: u32,
    pub call_discarded: u32,
    pub call_own_side: u32,
    /// Jokers played on the first or last trick, where they have no power,
    /// while the seat held something else it could play.
    pub joker_powerless_by_choice: u32,
    /// Jokers still held for the last trick.
    pub joker_on_last_trick: u32,
    /// The mighty played to a trick its own side was already winning.
    pub mighty_on_partner: u32,
    /// Jokers played to a trick its own side was already winning.
    pub joker_on_partner: u32,
    /// The mighty or a joker taking a trick with no point cards before
    /// the last three tricks.
    pub special_on_empty: u32,
    /// Examples, as text.
    pub examples: Vec<String>,
}

impl Audit {
    fn count(&mut self, flag: Flag) {
        let n = match flag {
            Flag::JokerOnPartner => &mut self.joker_on_partner,
            Flag::MightyOnPartner => &mut self.mighty_on_partner,
            Flag::SpecialOnEmpty => &mut self.special_on_empty,
            Flag::JokerPowerlessByChoice => &mut self.joker_powerless_by_choice,
            Flag::JokerOnLastTrick => &mut self.joker_on_last_trick,
            Flag::CallOwnHand => &mut self.call_own_hand,
            Flag::CallOwnSide => &mut self.call_own_side,
            Flag::CallDiscarded => &mut self.call_discarded,
        };
        *n += 1;
    }
}

/// The audit of `record`'s card play.
pub fn audit(rules: &Rules, record: &Record) -> Result<Audit> {
    let mut a = Audit {
        deal: record.deal,
        ..Audit::default()
    };
    let mut state = replay(rules, record, record.play_at)?;
    let side = |s| record.attacking(s);
    for (step, action) in record.log.iter().enumerate().skip(record.play_at) {
        let Turn::Seat(seat) = Mighty::turn(&state) else { break };
        let Action::Play { card, call_joker, .. } = *action else {
            break;
        };
        if call_joker {
            a.joker_calls += 1;
        }
        let view = Mighty::view(&state, Viewer::Seat(seat));
        let PhaseView::Play { trick_no, .. } = view.phase else {
            break;
        };
        for flag in flags(&state, seat, action, &side) {
            a.count(flag);
            if a.examples.len() < 3 {
                a.examples.push(format!(
                    "deal {} trick {} seat {seat} ({}) {flag}: played {card}, hand {}",
                    record.deal,
                    trick_no + 1,
                    if side(seat) { "attack" } else { "defence" },
                    view.hand.iter().map(|c| c.to_string()).collect::<Vec<_>>().join(" ")
                ));
            }
        }
        engine::apply_on_turn::<Mighty>(&mut state, action.clone()).map_err(|e| LabError::Replay {
            deal: record.deal,
            step,
            action: action.clone(),
            why: e.to_string(),
        })?;
    }
    Ok(a)
}
