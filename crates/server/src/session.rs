//! What a room needs from a game beyond one hand: table size, how each hand
//! is set up, and a bot to fill empty seats.

use engine::{Bot, Game};
use mighty::Mighty;
use mighty::bot::{Clumsy, tempered};
use mighty::rules::{Preset, Rules};
use mighty::search::SearchBot;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::time::Duration;

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
    fn validate(settings: &Self::Settings) -> Result<(), String>;

    /// Options for hand number `hand` (0-based) of a session; `last` is the
    /// hand before it in brief, when known.
    fn hand_options(settings: &Self::Settings, hand: u32, last: Option<&Self::Summary>) -> Self::Options;

    /// A bot of this strength for `seat`, which may think for about `think`
    /// (zero for its own default) on `threads` threads. Seats differ a
    /// little in temperament so a table of bots does not play as one.
    fn bot(level: BotLevel, seat: usize, think: Duration, threads: usize) -> Box<dyn Bot<Self> + Send>;

    /// A finished hand in brief, for the session's story.
    type Summary: Clone + Serialize + DeserializeOwned + Send + 'static;

    /// The hand in brief, once it is over.
    fn summary(state: &Self::State) -> Option<Self::Summary>;

    /// The preset the table plays, by id, for the stats.
    fn preset_id(settings: &Self::Settings) -> &'static str;

    /// Whether the table's players changed the preset's rules.
    fn customized(settings: &Self::Settings) -> bool;

    /// How a finished hand went, in a word, for the stats.
    fn outcome(state: &Self::State) -> &'static str;

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

/// How well a seated bot plays.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BotLevel {
    /// Plays sensibly but often slips when choosing a card.
    Easy,
    /// The rule-of-thumb bot.
    Normal,
    /// Searches sampled deals; the strongest.
    #[default]
    Hard,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MightySettings {
    pub preset: Preset,
    /// The table's own rules, when its players changed the preset's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rules: Option<Rules>,
}

impl MightySettings {
    pub fn rules(&self) -> Rules {
        self.rules.clone().unwrap_or_else(|| self.preset.rules())
    }
}

impl Default for MightySettings {
    fn default() -> MightySettings {
        MightySettings {
            preset: Preset::Gshs,
            rules: None,
        }
    }
}

impl SessionGame for Mighty {
    type Settings = MightySettings;
    type Summary = mighty::HandSummary;

    const NAME: &'static str = "mighty";

    fn seats(settings: &MightySettings) -> usize {
        settings.rules().players
    }

    fn validate(settings: &MightySettings) -> Result<(), String> {
        settings.rules().validate().map_err(|e| e.to_string())
    }

    /// The first bidder moves one seat to the left each hand, unless the
    /// rules hand the deal to last hand's friend or declarer.
    fn hand_options(settings: &MightySettings, hand: u32, last: Option<&mighty::HandSummary>) -> mighty::Options {
        let rules = settings.rules();
        let first_bidder = rules.first_bidder(hand, last);
        mighty::Options { rules, first_bidder }
    }

    fn bot(level: BotLevel, seat: usize, think: Duration, threads: usize) -> Box<dyn Bot<Mighty> + Send> {
        // Bolder or more careful bidders, by seat.
        let policy = tempered(seat);
        match level {
            BotLevel::Easy => Box::new(Clumsy::easy(policy)),
            BotLevel::Normal => Box::new(policy),
            // More sampled deals keep helping a little (2000 beat 200 by about
            // a third of a point per hand), so deal until the time is up.
            BotLevel::Hard if !think.is_zero() => Box::new(SearchBot {
                samples: 5000 * threads.max(1),
                budget: Some(think),
                threads,
                policy,
                ..SearchBot::default()
            }),
            BotLevel::Hard => Box::new(SearchBot {
                policy,
                ..SearchBot::default()
            }),
        }
    }

    fn summary(state: &mighty::State) -> Option<mighty::HandSummary> {
        state.summary()
    }

    fn preset_id(settings: &MightySettings) -> &'static str {
        settings.preset.name()
    }

    fn customized(settings: &MightySettings) -> bool {
        settings.rules.as_ref().is_some_and(|r| *r != settings.preset.rules())
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
            let mut state = Mighty::new_game(&Mighty::hand_options(&settings, 0, None)).unwrap();
            let mut rng = StdRng::seed_from_u64(seed);
            loop {
                let action = match Mighty::turn(&state) {
                    Turn::Over => break,
                    Turn::Chance => Mighty::sample_chance(&state, &mut rng),
                    Turn::Seat(seat) => {
                        let view = Mighty::view(&state, Viewer::Seat(seat));
                        let legal = Mighty::legal_actions(&state);
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
                        Mighty::bot(BotLevel::Normal, seat, Duration::ZERO, 1).act(&view, &legal, &mut rng)
                    }
                };
                Mighty::apply(&mut state, action).unwrap();
            }
        }
        // Both real and obvious choices come up in twenty hands.
        let follows = seen.iter().filter(|d| **d == Decision::Follow).count();
        assert!(follows > 0 && seen.contains(&Decision::Obvious));
    }
}
