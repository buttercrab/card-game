//! What a room needs from a game beyond one hand: table size, how each hand
//! is set up, and a bot to fill empty seats.

use crate::protocol::ServerError;
use engine::{Bot, Game};
use mighty::Mighty;
use mighty::bot::Level;
use mighty::card::Card;
use mighty::explain::Refusal;
use mighty::rules::{Contract, Preset, Rules};
use mighty_ai::LevelBots;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use ts_rs::TS;

pub trait SessionGame:
    Game<
        State: Send,
        Action: Serialize + DeserializeOwned + Send + 'static,
        View: Serialize + DeserializeOwned + Send + 'static,
    > + Send
    + 'static
{
    type Settings: Clone + Serialize + DeserializeOwned + Send + 'static;

    const NAME: &'static str;

    fn seats(settings: &Self::Settings) -> usize;

    /// Checks settings a player proposes for the table.
    fn validate(settings: &Self::Settings) -> Result<(), ServerError>;

    /// Pins whatever the settings take from outside the room (a preset's
    /// rules, say) as it is now, so the table keeps its rules for its whole
    /// life even if a later version of the server changes the preset.
    /// Settings pinned already stay as they are.
    fn freeze(settings: &mut Self::Settings);

    /// Options for hand number `hand` (0-based) of a session; `last` is the
    /// hand before it in brief, when known. Where the opening seat moves
    /// round the table hand by hand, it is the one `shift` seats on from
    /// hand number `hand`'s, so the room can keep the rotation with the
    /// players when they change seats.
    fn hand_options(settings: &Self::Settings, hand: u32, last: Option<&Self::Summary>, shift: usize) -> Self::Options;

    /// A bot of this strength with temperament number `temper`, which may
    /// think for about `think` (zero for its own default) on `threads`
    /// threads. Bots differ a little in temperament so a table of bots
    /// does not play as one; a seated bot keeps its own when it moves.
    fn bot(level: Level, temper: usize, think: Duration, threads: usize) -> Box<dyn Bot<Self> + Send>;

    /// A finished hand in brief, for the session's story.
    type Summary: Clone + Serialize + DeserializeOwned + Send + 'static;

    /// The rules a table plays by, as the room message carries them.
    type TableRules: Clone + Serialize + Send + 'static;

    /// The rules `settings` play by: the table's own, or its preset's.
    fn table_rules(settings: &Self::Settings) -> Self::TableRules;

    /// What a seat's table says beyond the view and the legal actions, so
    /// the client never works out the rules itself (why a card can't be
    /// played, say).
    type Notes: Clone + Serialize + Send + 'static;

    /// The notes for `seat`, given what it may do now.
    fn notes(state: &Self::State, seat: Option<usize>, legal: &[Self::Action]) -> Self::Notes;

    /// The hand in brief, once it is over.
    fn summary(state: &Self::State) -> Option<Self::Summary>;

    /// The preset the table plays, by id, for the stats.
    fn preset_id(settings: &Self::Settings) -> &'static str;

    /// Whether the table's players changed the preset's rules.
    fn customized(settings: &Self::Settings) -> bool;

    /// How a finished hand went, in a word, for the stats.
    fn outcome(state: &Self::State) -> &'static str;

    /// How long after the cards land `action` must wait, so nobody loses
    /// an action off their turn (one of [`Game::legal_actions`] for a seat
    /// the hand does not wait on) to a fast tap. Zero by default.
    fn grace(_state: &Self::State, _action: &Self::Action) -> Duration {
        Duration::ZERO
    }

    /// Whether a bot in `seat`, which the hand does not wait on, takes
    /// one of its `legal` actions anyway, and which. The room asks once
    /// each deal, and plays the answer after a short pause if it is still
    /// allowed then.
    fn bot_off_turn(level: Level, seat: usize, view: &Self::View, legal: &[Self::Action]) -> Option<Self::Action>;
    /// Whether the decision these actions offer deserves twice the table's
    /// turn time (a weightier choice than playing a card).
    fn long_decision(_legal: &[Self::Action]) -> bool {
        false
    }

    /// Renumbers the seats in a finished hand's summary after the players
    /// moved: whoever sat at seat `s` now sits at `new_seat[s]`.
    fn reseat(summary: &mut Self::Summary, new_seat: &[usize]);

    /// What kind of decision `view`'s seat faces among `legal`, which
    /// sets how long a bot seems to take over it. By default only a lone
    /// legal move counts as obvious.
    fn decision(_view: &Self::View, legal: &[Self::Action]) -> Decision {
        if legal.len() <= 1 {
            Decision::Obvious
        } else {
            Decision::Follow
        }
    }
}

/// What a seat is deciding, for the pace of a bot's moves: people bid and
/// plan with care, lead with a moment's thought, and follow quickly.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// No real choice: one legal move, or moves that all come to the same.
    Obvious,
    /// Following someone else's lead, with a choice to make.
    Follow,
    /// Leading.
    Lead,
    /// Bidding, or answering whether to throw the hand in.
    Bid,
    /// Setting the hand up: what to put back, whom to call.
    Plan,
}

/// Where misdeals come before any bid, the first bid waits this long after the deal,
/// so a fast bid never beats a 딜미스 to the table.
pub const FIRST_BID_GRACE: Duration = Duration::from_secs(2);

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
    pub action: mighty::Action,
    pub contract: Contract,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct MightySettings {
    pub preset: Preset,
    /// The table's own rules, when its players changed the preset's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub rules: Option<Rules>,
    /// The preset's rules as they were when the table chose it; see
    /// [`SessionGame::freeze`]. Without it, the preset's rules today.
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

impl SessionGame for Mighty {
    type Settings = MightySettings;
    type Summary = mighty::HandSummary;
    type TableRules = Rules;
    type Notes = MightyNotes;

    fn table_rules(settings: &MightySettings) -> Rules {
        settings.rules()
    }

    fn notes(state: &mighty::State, seat: Option<usize>, legal: &[mighty::Action]) -> MightyNotes {
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

    const NAME: &'static str = "mighty";

    fn seats(settings: &MightySettings) -> usize {
        settings.rules().players
    }

    fn validate(settings: &MightySettings) -> Result<(), ServerError> {
        Ok(settings.rules().validate()?)
    }

    fn freeze(settings: &mut MightySettings) {
        if settings.preset_rules.is_none() {
            settings.preset_rules = Some(settings.preset.rules());
        }
    }

    /// The first bidder moves one seat to the left each hand, unless the
    /// rules hand the deal to last hand's friend or declarer.
    fn hand_options(
        settings: &MightySettings,
        hand: u32,
        last: Option<&mighty::HandSummary>,
        shift: usize,
    ) -> mighty::Options {
        let rules = settings.rules();
        let n = rules.players as u32;
        let first_bidder = rules.first_bidder(hand % n + (shift as u32) % n, last);
        mighty::Options { rules, first_bidder }
    }

    /// Its own default is a second: tables always think against a clock.
    fn bot(level: Level, temper: usize, think: Duration, threads: usize) -> Box<dyn Bot<Mighty> + Send> {
        let think = if think.is_zero() { Duration::from_secs(1) } else { think };
        level.build_on(temper, Some(think), threads)
    }

    fn summary(state: &mighty::State) -> Option<mighty::HandSummary> {
        state.summary()
    }

    fn preset_id(settings: &MightySettings) -> &'static str {
        settings.preset.name()
    }

    fn customized(settings: &MightySettings) -> bool {
        settings.rules.as_ref().is_some_and(|r| *r != settings.base())
    }

    fn decision(view: &mighty::View, legal: &[mighty::Action]) -> Decision {
        use mighty::PhaseView;
        if view.obvious(legal) {
            return Decision::Obvious;
        }
        match &view.phase {
            PhaseView::Bidding { .. } => Decision::Bid,
            PhaseView::Exchange { .. } => Decision::Plan,
            PhaseView::Play { lead: None, .. } => Decision::Lead,
            PhaseView::Play { .. } => Decision::Follow,
            PhaseView::Dealing | PhaseView::Done { .. } => Decision::Obvious,
        }
    }

    fn outcome(state: &mighty::State) -> &'static str {
        match state.summary() {
            Some(s) if s.made => "made",
            Some(_) => "failed",
            None => "none",
        }
    }

    fn grace(state: &mighty::State, action: &mighty::Action) -> Duration {
        let first_bid = matches!(action, mighty::Action::Bid(_)) && state.before_first_bid();
        if first_bid && state.rules().misdeal.window == mighty::rules::MisdealWindow::BeforeFirstBid {
            FIRST_BID_GRACE
        } else {
            Duration::ZERO
        }
    }

    /// A misdeal, when the seat's 보통 bot would call one were it its turn
    /// to bid. Every level decides as 보통 does: the 고수 bot's search
    /// plays the seat whose turn it is, which this seat is not.
    fn bot_off_turn(
        _level: Level,
        seat: usize,
        view: &mighty::View,
        legal: &[mighty::Action],
    ) -> Option<mighty::Action> {
        let misdeal = mighty::Action::Misdeal;
        let calls = legal.contains(&misdeal) && mighty_ai::tempered(seat).calls_misdeal(&view.rules, &view.hand);
        calls.then_some(misdeal)
    }

    /// The exchange (discards, a trump change) and the friend call.
    fn long_decision(legal: &[mighty::Action]) -> bool {
        legal
            .iter()
            .any(|a| matches!(a, mighty::Action::Discard(_) | mighty::Action::CallFriend(_)))
    }

    fn reseat(summary: &mut mighty::HandSummary, new_seat: &[usize]) {
        summary.declarer = new_seat.get(summary.declarer).copied().unwrap_or(summary.declarer);
        summary.friend = summary.friend.map(|s| new_seat.get(s).copied().unwrap_or(s));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine::{Turn, Viewer};
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    /// Over hands of 보통 bots, every decision gets the pace its phase
    /// calls for, and a lone legal move is always obvious.
    #[test]
    fn decisions_follow_the_phase() {
        let mut seen = Vec::new();
        for seed in 0..20 {
            let settings = MightySettings::default();
            let mut state = Mighty::new_game(&Mighty::hand_options(&settings, 0, None, 0)).unwrap();
            let mut rng = StdRng::seed_from_u64(seed);
            loop {
                let action = match Mighty::turn(&state) {
                    Turn::Over => break,
                    Turn::Chance => Mighty::sample_chance(&state, &mut rng),
                    Turn::Seat(seat) => {
                        let view = Mighty::view(&state, Viewer::Seat(seat));
                        let legal = Mighty::legal_actions(&state, seat);
                        let decision = Mighty::decision(&view, &legal);
                        let expected = match &view.phase {
                            _ if legal.len() == 1 => vec![Decision::Obvious],
                            mighty::PhaseView::Bidding { .. } => vec![Decision::Bid],
                            mighty::PhaseView::Exchange { .. } => vec![Decision::Plan],
                            mighty::PhaseView::Play { lead: None, .. } => vec![Decision::Lead],
                            _ => vec![Decision::Follow, Decision::Obvious],
                        };
                        assert!(expected.contains(&decision), "{decision:?} for {:?}", view.phase);
                        seen.push(decision);
                        Mighty::bot(Level::Normal, seat, Duration::ZERO, 1).act(&view, &legal, &mut rng)
                    }
                };
                engine::apply_on_turn::<Mighty>(&mut state, action).unwrap();
            }
        }
        // Both real and obvious choices come up in twenty hands.
        let follows = seen.iter().filter(|d| **d == Decision::Follow).count();
        assert!(follows > 0 && seen.contains(&Decision::Obvious));
    }

    /// On every turn the notes say what the table would otherwise work out
    /// for itself: every card in hand is either played or explained, and
    /// every contract change or raise says what it sets. Others get none.
    #[test]
    fn notes_explain_every_unplayable_card_and_contract_change() {
        use mighty::Action;
        let (mut explained, mut changes) = (0, 0);
        for (seed, preset) in [Preset::Default, Preset::Gshs, Preset::Skku, Preset::Yonsei]
            .into_iter()
            .cycle()
            .take(24)
            .enumerate()
        {
            let settings = MightySettings::new(preset);
            let mut state = Mighty::new_game(&Mighty::hand_options(&settings, 0, None, 0)).unwrap();
            let mut rng = StdRng::seed_from_u64(seed as u64);
            loop {
                let action = match Mighty::turn(&state) {
                    Turn::Over => break,
                    Turn::Chance => Mighty::sample_chance(&state, &mut rng),
                    Turn::Seat(seat) => {
                        let legal = Mighty::legal_actions(&state, seat);
                        let notes = Mighty::notes(&state, Some(seat), &legal);
                        let other = (seat + 1) % 5;
                        assert_eq!(Mighty::notes(&state, Some(other), &[]), MightyNotes::default());
                        let view = Mighty::view(&state, Viewer::Seat(seat));
                        if let mighty::PhaseView::Play { .. } = view.phase {
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
                        Mighty::bot(Level::Normal, seat, Duration::ZERO, 1).act(&view, &legal, &mut rng)
                    }
                };
                engine::apply_on_turn::<Mighty>(&mut state, action).unwrap();
            }
        }
        assert!(explained > 0 && changes > 0, "{explained} {changes}");
    }
}
