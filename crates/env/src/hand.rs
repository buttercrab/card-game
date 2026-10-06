//! One hand: its seeds, rules and bots, played up to the next decision
//! the caller must make.

use crate::Error;
use crate::game::{EnvGame, RuleSampler};
use engine::{Bot, Game, Seat, Turn, Viewer};
use rand::distr::Distribution;
use rand::distr::weighted::WeightedIndex;
use rand::{RngCore, SeedableRng};
use rand_chacha::ChaCha8Rng;

/// The bots that fill seats nobody controls: each such seat draws one
/// style per hand, by weight.
#[derive(Debug, Clone)]
pub struct BotPool<S> {
    names: Vec<String>,
    specs: Vec<S>,
    weights: Option<WeightedIndex<f64>>,
}

impl<S: Clone> BotPool<S> {
    /// Bots by spec (see [`EnvGame::parse_bot`]) and weight.
    pub fn new<G: EnvGame<BotSpec = S>>(bots: &[(String, f64)]) -> Result<BotPool<S>, Error> {
        let specs = bots
            .iter()
            .map(|(name, _)| G::parse_bot(name).map_err(Error::Bot))
            .collect::<Result<_, _>>()?;
        let weights = if bots.is_empty() {
            None
        } else {
            Some(
                WeightedIndex::new(bots.iter().map(|&(_, w)| w))
                    .map_err(|e| Error::Bot(format!("bot weights: {e}")))?,
            )
        };
        Ok(BotPool {
            names: bots.iter().map(|(name, _)| name.clone()).collect(),
            specs,
            weights,
        })
    }

    /// Every bot equally likely.
    pub fn uniform<G: EnvGame<BotSpec = S>>(bots: &[String]) -> Result<BotPool<S>, Error> {
        let weighted: Vec<(String, f64)> = bots.iter().map(|b| (b.clone(), 1.0)).collect();
        BotPool::new::<G>(&weighted)
    }

    /// The specs as given, by style index.
    pub fn names(&self) -> &[String] {
        &self.names
    }

    fn draw(&self, rng: &mut dyn RngCore) -> Option<usize> {
        self.weights.as_ref().map(|w| w.sample(rng))
    }
}

/// How every hand is set up: its rules, who plays which seat.
#[derive(Debug, Clone)]
pub struct Setup<G: EnvGame> {
    pub rules: RuleSampler<G::Rules>,
    pub bots: BotPool<G::BotSpec>,
    /// `controlled[seat]`: the caller plays this seat. Seats a table does
    /// not have are ignored; seats past the end are bots.
    pub controlled: Vec<bool>,
}

impl<G: EnvGame> Setup<G> {
    pub fn controls(&self, seat: Seat) -> bool {
        self.controlled.get(seat).copied().unwrap_or(false)
    }
}

/// A bot in its seat, and which style of the pool it is.
struct Seated<G: Game> {
    style: usize,
    bot: Box<dyn Bot<G> + Send>,
}

/// A bot's decision, as a hand reports it to whoever records them.
pub struct Decision<'a, G: Game> {
    /// The position before the action.
    pub state: &'a G::State,
    pub seat: Seat,
    pub view: &'a G::View,
    pub legal: &'a [G::Action],
    pub action: &'a G::Action,
    /// The bot's index in the [`BotPool`].
    pub style: usize,
}

/// Where a hand stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// The caller must act for this seat.
    ToAct(Seat),
    Over,
}

/// One hand, reproducible from its seed and the caller's actions.
///
/// The seed feeds three independent streams: the deals (stream 0, as
/// `sim` plays), the bots' choices (stream 1) and the setup (stream 2:
/// the rules, the options such as who bids first, and each bot seat's
/// style). So the same seed deals the same cards whoever plays them.
pub struct Hand<G: EnvGame> {
    seed: u64,
    rules: G::Rules,
    state: G::State,
    bots: Vec<Option<Seated<G>>>,
    chance: ChaCha8Rng,
    play: ChaCha8Rng,
}

/// A ChaCha8 generator for `seed` on `stream`.
pub(crate) fn stream(seed: u64, stream: u64) -> ChaCha8Rng {
    let mut rng = ChaCha8Rng::seed_from_u64(seed);
    rng.set_stream(stream);
    rng
}

impl<G: EnvGame> Hand<G> {
    pub fn new(setup: &Setup<G>, seed: u64) -> Result<Hand<G>, Error> {
        let mut rng = stream(seed, 2);
        let rules = setup.rules.draw::<G>(&mut rng)?;
        let options = crate::game::draw_options::<G>(&rules, &mut rng);
        let state = G::new_game(&options).map_err(|e| Error::Rules(e.to_string()))?;
        let bots = (0..G::seat_count(&state))
            .map(|seat| {
                if setup.controls(seat) {
                    return Ok(None);
                }
                let style = setup
                    .bots
                    .draw(&mut rng)
                    .ok_or_else(|| Error::Bot(format!("seat {seat} needs a bot and the pool is empty")))?;
                let bot = G::bot(&setup.bots.specs[style], seat);
                Ok(Some(Seated { style, bot }))
            })
            .collect::<Result<_, Error>>()?;
        Ok(Hand {
            seed,
            rules,
            state,
            bots,
            chance: stream(seed, 0),
            play: stream(seed, 1),
        })
    }

    pub fn seed(&self) -> u64 {
        self.seed
    }

    pub fn rules(&self) -> &G::Rules {
        &self.rules
    }

    pub fn state(&self) -> &G::State {
        &self.state
    }

    pub fn seats(&self) -> usize {
        self.bots.len()
    }

    /// The pool index of the bot in `seat`, or `None` for a seat the caller
    /// plays.
    pub fn style(&self, seat: Seat) -> Option<usize> {
        self.bots.get(seat)?.as_ref().map(|b| b.style)
    }

    /// Deals and plays the bots' turns until a seat the caller controls
    /// must act or the hand is over, reporting each bot decision to
    /// `record` before it is applied.
    pub fn advance(&mut self, mut record: impl FnMut(Decision<'_, G>)) -> Result<Status, Error> {
        loop {
            let action = match G::turn(&self.state) {
                Turn::Over => return Ok(Status::Over),
                Turn::Chance => G::sample_chance(&self.state, &mut self.chance),
                Turn::Seat(seat) => {
                    let Some(seated) = &mut self.bots[seat] else {
                        return Ok(Status::ToAct(seat));
                    };
                    let legal = engine::legal_on_turn::<G>(&self.state);
                    let view = G::view(&self.state, Viewer::Seat(seat));
                    let action = seated.bot.act(&view, &legal, &mut self.play);
                    record(Decision {
                        state: &self.state,
                        seat,
                        view: &view,
                        legal: &legal,
                        action: &action,
                        style: seated.style,
                    });
                    action
                }
            };
            engine::apply_on_turn::<G>(&mut self.state, action).map_err(|e| Error::Game(e.to_string()))?;
        }
    }

    /// Applies the caller's action for the seat to act.
    pub fn act(&mut self, action: G::Action) -> Result<(), Error> {
        engine::apply_on_turn::<G>(&mut self.state, action).map_err(|e| Error::Game(e.to_string()))
    }

    /// Each seat's payoff, once the hand is over.
    pub fn payoffs(&self) -> Option<Vec<i64>> {
        G::payoffs(&self.state)
    }
}
