//! What looks wasteful about a card play in hindsight, from the true cards:
//! the flags the audit counts and the regret experiment attaches to each
//! decision, defined once.

use engine::{Game, Seat, Viewer};
use mighty::world::Phase;
use mighty::{Action, Mighty, PhaseView, State};
use serde::{Deserialize, Serialize};
use std::fmt;

/// One way a play looks wasteful.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Flag {
    /// A joker played to a trick its own side was already winning, with
    /// tricks still to come.
    JokerOnPartner,
    /// The mighty, likewise.
    MightyOnPartner,
    /// The mighty or a joker played to a trick with no point card in it
    /// yet, before the last three tricks.
    SpecialOnEmpty,
    /// A joker on the first trick, where it has no power, while the seat
    /// held another card it could play.
    JokerPowerlessByChoice,
    /// A joker held to the last trick.
    JokerOnLastTrick,
    /// A joker call whose joker the caller held itself.
    CallOwnHand,
    /// A joker call whose joker sat with the caller's own side.
    CallOwnSide,
    /// A joker call whose joker nobody held any more: discarded.
    CallDiscarded,
}

impl Flag {
    pub fn name(self) -> &'static str {
        match self {
            Flag::JokerOnPartner => "joker_on_partner",
            Flag::MightyOnPartner => "mighty_on_partner",
            Flag::SpecialOnEmpty => "special_on_empty",
            Flag::JokerPowerlessByChoice => "joker_powerless_by_choice",
            Flag::JokerOnLastTrick => "joker_on_last_trick",
            Flag::CallOwnHand => "call_own_hand",
            Flag::CallOwnSide => "call_own_side",
            Flag::CallDiscarded => "call_discarded",
        }
    }
}

impl fmt::Display for Flag {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

/// The flags on `action`, `seat`'s play in `state` (the card play under
/// way), the sides told apart by `attacking`. Empty for anything but a
/// card played.
pub fn flags(state: &State, seat: Seat, action: &Action, attacking: &dyn Fn(Seat) -> bool) -> Vec<Flag> {
    let Action::Play { card, call_joker, .. } = *action else {
        return Vec::new();
    };
    let view = Mighty::view(state, Viewer::Seat(seat));
    let PhaseView::Play {
        trick_no,
        plays,
        leading,
        contract,
        ..
    } = &view.phase
    else {
        return Vec::new();
    };
    let rules = &view.rules;
    let legal = engine::legal_on_turn::<Mighty>(state);
    let choice = legal.len() > 1;
    let last = trick_no + 1 == rules.hand_size;
    let mighty = rules.mighty(contract.trump);
    let special = card == mighty || card.is_joker();
    let partner_winning = leading.is_some_and(|w| w != seat && attacking(w) == attacking(seat));
    let points = plays.iter().filter(|p| p.card.is_point()).count();
    let others = legal
        .iter()
        .any(|a| matches!(a, Action::Play { card: c, .. } if !c.is_joker()));
    let mut out = Vec::new();
    if card.is_joker() && last {
        out.push(Flag::JokerOnLastTrick);
    }
    if card.is_joker() && choice && *trick_no == 0 && others {
        out.push(Flag::JokerPowerlessByChoice);
    }
    if choice && partner_winning && !last {
        if card.is_joker() {
            out.push(Flag::JokerOnPartner);
        } else if card == mighty {
            out.push(Flag::MightyOnPartner);
        }
    }
    if choice && special && points == 0 && !plays.is_empty() && trick_no + 3 < rules.hand_size {
        out.push(Flag::SpecialOnEmpty);
    }
    if call_joker {
        // The joker the call called, if the call had effect, and who held it.
        let mut after = state.clone();
        after.step(seat, action.clone());
        if let Phase::Play(p) = after.phase()
            && let Some(joker) = p.called_joker
        {
            match (0..rules.players).find(|&s| state.hands()[s].contains(&joker)) {
                Some(h) if h == seat => out.push(Flag::CallOwnHand),
                Some(h) if attacking(h) == attacking(seat) => out.push(Flag::CallOwnSide),
                Some(_) => {}
                None => out.push(Flag::CallDiscarded),
            }
        }
    }
    out
}
