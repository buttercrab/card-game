//! Hindsight regret of every card played in recorded hands.

use crate::error::{LabError, Result};
use crate::hindsight::flags;
use crate::record::{Record, replay};
use engine::{Game, Seat, Turn, Viewer};
use mighty::rules::Rules;
use mighty::{Action, Mighty, PhaseView};
use mighty_ai::{SimpleBot, play_out};
use serde::{Deserialize, Serialize};

/// One card-play decision of a recorded hand, judged in hindsight.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Regret {
    pub trick_no: usize,
    pub seat: Seat,
    pub attacking: bool,
    pub leading: bool,
    /// What kind of card was played: `joker`, `mighty`, `call` (a joker
    /// call), `trump` or `plain`.
    pub kind: String,
    /// The hindsight flags on this play ([`crate::hindsight::Flag`]).
    pub flags: Vec<String>,
    /// The seat's payoff after the best legal play minus after the one
    /// made, both played on with every hand known: simple bots, the last
    /// `endgame` tricks solved exactly.
    pub regret: i64,
    /// The play that did best, when it was not the one made.
    pub best: Option<Action>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegretResult {
    pub deal: u64,
    pub declarer: Seat,
    pub decisions: Vec<Regret>,
}

/// Hindsight regret of every card-play decision with a choice in `record`:
/// how much better the seat would have done, seeing every hand, by playing
/// otherwise, the rest of the hand played by simple bots that also see
/// everything and, for the last `endgame` tricks, perfectly. Cheaper than
/// replaying with a stronger bot, and it says which decisions cost most;
/// but it credits knowledge no seat had, so it bounds what a bot could gain.
pub fn regret(rules: &Rules, record: &Record, endgame: usize) -> Result<RegretResult> {
    let mut state = replay(rules, record, record.play_at)?;
    let side = |s| record.attacking(s);
    let policy = SimpleBot::default();
    let mut decisions = Vec::new();
    for (step, action) in record.log.iter().enumerate().skip(record.play_at) {
        let Turn::Seat(seat) = Mighty::turn(&state) else { break };
        let Action::Play { card, call_joker, .. } = *action else {
            break;
        };
        let legal = Mighty::legal_actions(&state);
        let view = Mighty::view(&state, Viewer::Seat(seat));
        let PhaseView::Play {
            trick_no,
            plays,
            contract,
            ..
        } = &view.phase
        else {
            break;
        };
        if legal.len() > 1 {
            let value = |a: &Action| {
                let mut s = state.clone();
                s.step(seat, a.clone());
                play_out(policy, endgame, s, seat)
            };
            let made = value(action);
            let (best_value, best) = legal
                .iter()
                .map(|a| (value(a), a))
                .max_by_key(|(v, _)| *v)
                .expect("a choice");
            let kind = if card.is_joker() {
                "joker"
            } else if card == rules.mighty(contract.trump) {
                "mighty"
            } else if call_joker {
                "call"
            } else if card.suit() == contract.trump && contract.trump.is_some() {
                "trump"
            } else {
                "plain"
            };
            decisions.push(Regret {
                trick_no: *trick_no,
                seat,
                attacking: side(seat),
                leading: plays.is_empty(),
                kind: kind.to_string(),
                flags: flags(&state, seat, action, &side)
                    .into_iter()
                    .map(|f| f.name().to_string())
                    .collect(),
                regret: best_value - made,
                best: (best != action && best_value > made).then(|| best.clone()),
            });
        }
        Mighty::apply(&mut state, action.clone()).map_err(|e| LabError::Replay {
            deal: record.deal,
            step,
            action: action.clone(),
            why: e.to_string(),
        })?;
    }
    Ok(RegretResult {
        deal: record.deal,
        declarer: record.declarer,
        decisions,
    })
}
