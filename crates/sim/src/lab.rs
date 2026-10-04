//! Experiments on where the bots lose points, phase by phase. Hands are
//! first played by one table of bots and recorded ([`gen`]); experiments
//! then replay a recorded hand up to some decision and play it on with a
//! change: another bot in one seat for the card play, the other choice at
//! a bid, another exchange. Every seat draws its randomness from its own
//! stream, seeded by the hand and the phase, so a variant that chooses
//! exactly what the recorded bot chose replays the recorded hand exactly,
//! and the difference in payoff is the change's alone.

use crate::spec::Spec;
use engine::{Game, Seat, Turn, Viewer};
use mighty::bot::SimpleBot;
use mighty::card::{ACE, Card, Suit};
use mighty::rules::{Contract, Rules};
use mighty::search::{SearchBot, finish, playout};
use mighty::{Action, FriendCall, Mighty, Options, PhaseView, State, View};
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;
use serde::{Deserialize, Serialize};

/// Randomness tags: which part of a hand a stream serves.
pub const TAG_BID: u64 = 1;
pub const TAG_EXCHANGE: u64 = 2;
pub const TAG_PLAY: u64 = 3;
/// Everything after a changed decision in the bidding.
pub const TAG_AFTER_BID: u64 = 4;
/// Searches the experiments run themselves.
pub const TAG_LAB: u64 = 5;

fn mix(mut x: u64) -> u64 {
    // splitmix64
    x = x.wrapping_add(0x9e37_79b9_7f4a_7c15);
    x = (x ^ (x >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    x ^ (x >> 31)
}

/// The stream for `seat` (or the dealer, `seats`) in part `tag` of hand `deal`.
pub fn stream(deal: u64, tag: u64, seat: usize) -> ChaCha8Rng {
    ChaCha8Rng::seed_from_u64(mix(mix(deal) ^ (tag << 48) ^ seat as u64))
}

fn streams(deal: u64, tag: u64, seats: usize) -> Vec<ChaCha8Rng> {
    (0..=seats).map(|s| stream(deal, tag, s)).collect()
}

/// Who decides for a seat.
#[derive(Debug, Clone, Copy)]
pub enum Actor {
    Bot(Spec),
    /// Sees every hand. Plays each legal action out `rollouts` times on
    /// the real cards with simple bots in every seat, each of which picks
    /// a random legal action instead this often (`slip`), and keeps the
    /// best on average when it beats the simple bot's choice by a standard
    /// error: the search bot, minus the guessing.
    Cheat {
        rollouts: usize,
        slip: f64,
    },
}

impl Actor {
    /// A `sim` bot, or `cheat[:ROLLOUTS[:SLIP]]`.
    pub fn parse(s: &str) -> Result<Actor, String> {
        let Some(rest) = s.strip_prefix("cheat") else {
            return s.parse().map(Actor::Bot);
        };
        let mut parts = rest.split(':').skip(1);
        let bad = || format!("bad cheat spec {s:?}");
        let rollouts = parts.next().map_or(Ok(1), |n| n.parse().map_err(|_| bad()))?;
        let slip = parts.next().map_or(Ok(0.0), |n| n.parse().map_err(|_| bad()))?;
        Ok(Actor::Cheat { rollouts, slip })
    }

    pub fn act(&self, state: &State, seat: Seat, rng: &mut ChaCha8Rng) -> Action {
        let legal = Mighty::legal_actions(state);
        if legal.len() == 1 {
            return legal[0].clone();
        }
        let view = Mighty::view(state, Viewer::Seat(seat));
        match *self {
            Actor::Bot(spec) => spec.build().act(&view, &legal, rng),
            Actor::Cheat { rollouts, slip } => {
                let policy = SimpleBot::default();
                let usual = engine::Bot::act(&mut policy.clone(), &view, &legal, rng);
                let base = legal.iter().position(|a| *a == usual).expect("legal");
                let mut scores = vec![Vec::with_capacity(rollouts); legal.len()];
                for _ in 0..rollouts.max(1) {
                    // Every action meets the same luck in each round.
                    let round = rand::Rng::random::<u64>(rng);
                    for (a, score) in legal.iter().zip(&mut scores) {
                        let mut s = state.clone();
                        Mighty::apply(&mut s, a.clone()).expect("legal");
                        let mut r = ChaCha8Rng::seed_from_u64(round);
                        score.push(noisy_playout(s, seat, slip, &mut r) as f64);
                    }
                }
                let mut best = (0.0, base);
                for (i, s) in scores.iter().enumerate() {
                    let d: Vec<f64> = s.iter().zip(&scores[base]).map(|(a, b)| a - b).collect();
                    let n = d.len() as f64;
                    let mean = d.iter().sum::<f64>() / n;
                    let se = if n > 1.0 {
                        (d.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (n - 1.0) / n).sqrt()
                    } else {
                        0.0
                    };
                    if mean > best.0 && mean > se {
                        best = (mean, i);
                    }
                }
                legal[best.1].clone()
            }
        }
    }
}

/// Plays `state` to the end with simple bots that slip to a random legal
/// action this often: `me`'s payoff.
fn noisy_playout(mut state: State, me: Seat, slip: f64, rng: &mut ChaCha8Rng) -> i64 {
    use rand::Rng;
    if slip <= 0.0 {
        return playout(SimpleBot::default(), state, me, rng);
    }
    let mut policy = SimpleBot::default();
    for _ in 0..2000 {
        let action = match Mighty::turn(&state) {
            Turn::Over => return Mighty::payoffs(&state).map_or(0, |p| p[me]),
            Turn::Chance => Mighty::sample_chance(&state, rng),
            Turn::Seat(seat) => {
                let legal = Mighty::legal_actions(&state);
                if rng.random_bool(slip) {
                    legal[rng.random_range(0..legal.len())].clone()
                } else {
                    let view = Mighty::view(&state, Viewer::Seat(seat));
                    engine::Bot::act(&mut policy, &view, &legal, rng)
                }
            }
        };
        Mighty::apply(&mut state, action).expect("legal");
    }
    0
}

/// The bots at a table, by phase: one actor for every seat, except one
/// seat that may play differently in one phase.
#[derive(Debug, Clone, Copy)]
pub struct Table {
    pub all: Actor,
    pub focus: Option<(Seat, Phase, Actor)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Phase {
    Bidding,
    Exchange,
    Play,
    Over,
}

pub fn phase(state: &State) -> Phase {
    if matches!(Mighty::turn(state), Turn::Over) {
        return Phase::Over;
    }
    match Mighty::view(state, Viewer::Spectator).phase {
        PhaseView::Exchange { .. } => Phase::Exchange,
        PhaseView::Play { .. } => Phase::Play,
        PhaseView::Done { .. } => Phase::Over,
        PhaseView::Dealing | PhaseView::Bidding { .. } => Phase::Bidding,
    }
}

impl Table {
    pub fn actor(&self, seat: Seat, phase: Phase) -> Actor {
        match self.focus {
            Some((s, p, actor)) if s == seat && p == phase => actor,
            _ => self.all,
        }
    }
}

/// One decision, as an experiment saw it.
pub struct Decision<'a> {
    pub state: &'a State,
    pub seat: Seat,
    pub action: &'a Action,
    pub index: usize,
    /// The seat's randomness as it was before deciding.
    pub rng: ChaCha8Rng,
}

/// Plays on from `state` until the hand reaches a phase past `until`, with
/// `rngs` (one per seat and one for the dealer). Calls `watch` after each
/// seat's decision.
pub fn advance(
    state: &mut State,
    table: &Table,
    rngs: &mut [ChaCha8Rng],
    log: &mut Vec<Action>,
    until: Phase,
    watch: &mut dyn FnMut(Decision),
) {
    let seats = rngs.len() - 1;
    loop {
        let now = phase(state);
        if now == Phase::Over || now as u8 > until as u8 {
            return;
        }
        let action = match Mighty::turn(state) {
            Turn::Over => return,
            Turn::Chance => Mighty::sample_chance(state, &mut rngs[seats]),
            Turn::Seat(seat) => {
                let rng = rngs[seat].clone();
                let action = table.actor(seat, now).act(state, seat, &mut rngs[seat]);
                watch(Decision {
                    state,
                    seat,
                    action: &action,
                    index: log.len(),
                    rng,
                });
                action
            }
        };
        Mighty::apply(state, action.clone()).expect("bots choose legal actions");
        log.push(action);
    }
}

/// A bid or pass, with what the simple bot thought of the hand.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BidDecision {
    pub index: usize,
    pub seat: Seat,
    pub action: Action,
    /// The simple bot's best trump and its estimate of the hand there.
    pub trump: Option<Suit>,
    pub estimate: f32,
    /// The cheapest legal bid in that trump, if any.
    pub cheapest: Option<u8>,
}

/// One hand played by a table of bots, to replay.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Record {
    pub deal: u64,
    pub first_bidder: Seat,
    pub log: Vec<Action>,
    /// Where the exchange and the card play begin in `log`.
    pub exchange_at: usize,
    pub play_at: usize,
    pub bids: Vec<BidDecision>,
    pub declarer: Seat,
    pub contract: Contract,
    pub call: FriendCall,
    pub friend: Option<Seat>,
    pub team_points: u8,
    pub payoffs: Vec<i64>,
}

pub fn options(rules: &Rules, deal: u64) -> Options {
    Options {
        rules: rules.clone(),
        first_bidder: (deal % rules.players as u64) as usize,
    }
}

/// The best trump by the simple bot's estimate, the estimate, and the
/// cheapest legal bid in it.
pub fn simple_read(view: &View, legal: &[Action]) -> (Option<Suit>, f32, Option<u8>) {
    let bot = SimpleBot::default();
    let (trump, estimate) = Suit::ALL
        .into_iter()
        .map(|s| (Some(s), bot.estimate(&view.rules, &view.hand, Some(s))))
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .expect("four suits");
    let cheapest = legal
        .iter()
        .filter_map(|a| match a {
            Action::Bid(c) if c.trump == trump => Some(c.count),
            _ => None,
        })
        .min();
    (trump, estimate, cheapest)
}

/// Plays hand `deal` with `bot` in every seat, recording it.
pub fn generate(rules: &Rules, deal: u64, bot: Actor) -> Record {
    let seats = rules.players;
    let options = options(rules, deal);
    let mut state = Mighty::new_game(&options).expect("valid rules");
    let table = Table { all: bot, focus: None };
    let mut log = Vec::new();
    let mut bids = Vec::new();
    let mut rngs = streams(deal, TAG_BID, seats);
    advance(&mut state, &table, &mut rngs, &mut log, Phase::Bidding, &mut |d| {
        let view = Mighty::view(d.state, Viewer::Seat(d.seat));
        let legal = Mighty::legal_actions(d.state);
        let (trump, estimate, cheapest) = simple_read(&view, &legal);
        bids.push(BidDecision {
            index: d.index,
            seat: d.seat,
            action: d.action.clone(),
            trump,
            estimate,
            cheapest,
        });
    });
    let exchange_at = log.len();
    let mut rngs = streams(deal, TAG_EXCHANGE, seats);
    advance(&mut state, &table, &mut rngs, &mut log, Phase::Exchange, &mut |_| {});
    let play_at = log.len();
    let mut rngs = streams(deal, TAG_PLAY, seats);
    advance(&mut state, &table, &mut rngs, &mut log, Phase::Play, &mut |_| {});
    // Redeals restart the bidding; only the last deal's bids count.
    let last_deal = log.iter().rposition(|a| matches!(a, Action::Deal { .. })).unwrap_or(0);
    bids.retain(|b| b.index > last_deal);
    finish_record(deal, options.first_bidder, log, exchange_at, play_at, bids, &state)
}

fn finish_record(
    deal: u64,
    first_bidder: Seat,
    log: Vec<Action>,
    exchange_at: usize,
    play_at: usize,
    bids: Vec<BidDecision>,
    state: &State,
) -> Record {
    let PhaseView::Done {
        declarer,
        contract,
        call,
        friend,
        team_points,
        payoffs,
        ..
    } = Mighty::view(state, Viewer::Spectator).phase
    else {
        panic!("hand not over");
    };
    Record {
        deal,
        first_bidder,
        log,
        exchange_at,
        play_at,
        bids,
        declarer,
        contract,
        call,
        friend,
        team_points,
        payoffs,
    }
}

/// The state after the first `upto` actions of `record`.
pub fn replay(rules: &Rules, record: &Record, upto: usize) -> State {
    let mut state = Mighty::new_game(&options(rules, record.deal)).expect("valid rules");
    for action in &record.log[..upto] {
        Mighty::apply(&mut state, action.clone()).expect("recorded actions replay");
    }
    state
}

/// The outcome of a hand played on from some point.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Outcome {
    pub payoffs: Vec<i64>,
    pub declarer: Seat,
    pub contract: Contract,
    pub team_points: u8,
}

pub fn outcome(state: &State) -> Outcome {
    let PhaseView::Done {
        declarer,
        contract,
        team_points,
        payoffs,
        ..
    } = Mighty::view(state, Viewer::Spectator).phase
    else {
        panic!("hand not over");
    };
    Outcome {
        payoffs,
        declarer,
        contract,
        team_points,
    }
}

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

/// Replays the card play of `record` with `variant` in seat `focus` and
/// `base` everywhere else.
pub fn play_variant(rules: &Rules, record: &Record, base: Actor, focus: Seat, variant: (&str, Actor)) -> PlayResult {
    let seats = rules.players;
    let mut state = replay(rules, record, record.play_at);
    let table = Table {
        all: base,
        focus: Some((focus, Phase::Play, variant.1)),
    };
    let mut rngs = streams(record.deal, TAG_PLAY, seats);
    let mut log = Vec::new();
    let mut differing = Vec::new();
    let mut lab_rng = stream(record.deal, TAG_LAB, focus);
    let attacking = focus == record.declarer || record.friend == Some(focus);
    advance(&mut state, &table, &mut rngs, &mut log, Phase::Play, &mut |d| {
        if d.seat != focus {
            return;
        }
        let legal = Mighty::legal_actions(d.state);
        if legal.len() == 1 {
            return;
        }
        let hard = base.act(d.state, focus, &mut d.rng.clone());
        if hard == *d.action {
            return;
        }
        let view = Mighty::view(d.state, Viewer::Seat(focus));
        let simple = engine::Bot::act(&mut SimpleBot::default(), &view, &legal, &mut lab_rng);
        let PhaseView::Play { trick_no, plays, .. } = &view.phase else {
            return;
        };
        differing.push(PlayDecision {
            trick_no: *trick_no,
            leading: plays.is_empty(),
            attacking,
            chosen: d.action.clone(),
            hard,
            simple,
        });
    });
    let done = outcome(&state);
    PlayResult {
        deal: record.deal,
        focus,
        variant: variant.0.to_string(),
        declarer: record.declarer,
        attacking,
        base: record.payoffs[focus],
        payoff: done.payoffs[focus],
        team_points: done.team_points,
        base_team_points: record.team_points,
        differing,
    }
}

/// What the simple-bot playouts think a hand is worth as declarer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Oracle {
    /// Weighted mean of the declarer's side's points, and the weighted
    /// share of deals ending with each total, 0 to 20.
    pub mean_points: f64,
    pub points: Vec<f64>,
}

/// From the bidding view of `seat` in `state`, as if `seat` bid `contract`
/// and everyone else passed: the declarer's side's points over sampled
/// deals, with simple bots exchanging and playing.
pub fn bid_oracle(state: &State, seat: Seat, contract: Contract, worlds: usize, rng: &mut ChaCha8Rng) -> Oracle {
    let view = Mighty::view(state, Viewer::Seat(seat));
    let search = SearchBot::default();
    let mut points = Vec::new();
    for (world, weight) in search.worlds(&view, worlds, rng) {
        let mut s = world;
        if Mighty::apply(&mut s, Action::Bid(contract)).is_err() {
            continue;
        }
        while phase(&s) == Phase::Bidding {
            if Mighty::apply(&mut s, Action::Pass).is_err() {
                break;
            }
        }
        let table = Table {
            all: Actor::Bot(Spec::Simple(SimpleBot::default())),
            focus: None,
        };
        let mut rngs = streams(0, TAG_LAB, Mighty::seat_count(&s));
        advance(&mut s, &table, &mut rngs, &mut Vec::new(), Phase::Play, &mut |_| {});
        if phase(&s) == Phase::Over {
            points.push((f64::from(outcome(&s).team_points), weight));
        }
    }
    let total: f64 = points.iter().map(|p| p.1).sum::<f64>().max(1e-12);
    let mean_points = points.iter().map(|(p, w)| p * w).sum::<f64>() / total;
    let mut histogram = vec![0.0; 21];
    for (p, w) in &points {
        histogram[(*p as usize).min(20)] += w / total;
    }
    Oracle {
        mean_points,
        points: histogram,
    }
}

/// Bidding experiments on one recorded hand.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BidResult {
    pub deal: u64,
    pub declarer: Seat,
    pub contract: Contract,
    pub team_points: u8,
    pub declarer_payoff: i64,
    /// The declarer's payoff had it passed instead of its winning bid.
    pub pass_instead: Option<i64>,
    /// What the playouts thought of the winning bid when it was made.
    pub oracle: Option<Oracle>,
    /// The closest pass: a seat that passed with the simple bot's
    /// estimate nearest the cheapest bid, what it would have bid, its
    /// estimate, and its payoff passing and bidding.
    pub close_pass: Option<ClosePass>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClosePass {
    pub seat: Seat,
    pub bid: Contract,
    pub estimate: f32,
    pub passed: i64,
    pub bidding: i64,
    pub bidding_contract: Contract,
    pub bidding_team_points: u8,
    pub bidding_declarer: Seat,
    pub oracle: Oracle,
}

fn play_on(rules: &Rules, record: &Record, at: usize, action: Action, bot: Actor) -> Outcome {
    let mut state = replay(rules, record, at);
    Mighty::apply(&mut state, action).expect("a legal alternative");
    let mut rngs = streams(record.deal, TAG_AFTER_BID, rules.players);
    advance(
        &mut state,
        &Table { all: bot, focus: None },
        &mut rngs,
        &mut Vec::new(),
        Phase::Play,
        &mut |_| {},
    );
    outcome(&state)
}

pub fn bid_experiment(rules: &Rules, record: &Record, bot: Actor, worlds: usize) -> BidResult {
    let mut lab_rng = stream(record.deal, TAG_LAB, 99);
    let winning = record
        .bids
        .iter()
        .rev()
        .find(|b| b.seat == record.declarer && matches!(b.action, Action::Bid(_)));
    let (pass_instead, oracle) = match winning {
        Some(b) => {
            let state = replay(rules, record, b.index);
            let legal = Mighty::legal_actions(&state);
            let pass = legal
                .contains(&Action::Pass)
                .then(|| play_on(rules, record, b.index, Action::Pass, bot).payoffs[b.seat]);
            let Action::Bid(c) = b.action else { unreachable!() };
            (pass, Some(bid_oracle(&state, b.seat, c, worlds, &mut lab_rng)))
        }
        None => (None, None),
    };
    let close = record
        .bids
        .iter()
        .filter(|b| b.action == Action::Pass)
        .filter_map(|b| Some((b, f32::from(b.cheapest?) - b.estimate)))
        .filter(|(_, gap)| *gap <= 1.5)
        .min_by(|a, b| a.1.total_cmp(&b.1));
    let close_pass = close.map(|(b, _)| {
        let bid = Contract {
            trump: b.trump,
            count: b.cheapest.expect("filtered"),
        };
        let state = replay(rules, record, b.index);
        let oracle = bid_oracle(&state, b.seat, bid, worlds, &mut lab_rng);
        let done = play_on(rules, record, b.index, Action::Bid(bid), bot);
        ClosePass {
            seat: b.seat,
            bid,
            estimate: b.estimate,
            passed: record.payoffs[b.seat],
            bidding: done.payoffs[b.seat],
            bidding_contract: done.contract,
            bidding_team_points: done.team_points,
            bidding_declarer: done.declarer,
            oracle,
        }
    });
    BidResult {
        deal: record.deal,
        declarer: record.declarer,
        contract: record.contract,
        team_points: record.team_points,
        declarer_payoff: record.payoffs[record.declarer],
        pass_instead,
        oracle,
        close_pass,
    }
}

/// How the declarer exchanged in one variant, and how the hand went.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExchangeResult {
    pub deal: u64,
    pub variant: String,
    pub contract: Contract,
    pub base_contract: Contract,
    pub discards: Vec<Card>,
    pub base_discards: Vec<Card>,
    pub call: FriendCall,
    pub base_call: FriendCall,
    pub payoff: i64,
    pub base: i64,
    pub team_points: u8,
    pub base_team_points: u8,
}

/// How the declarer exchanges in an experiment.
#[derive(Debug, Clone, Copy)]
pub enum Exchanger {
    /// The recorded bot's discards, and a bot's friend call.
    Bot(Actor),
    /// Searches whole sets of discards (and changes of trump) at once,
    /// then the friend call, on `worlds` sampled deals.
    Joint { worlds: usize },
    /// The recorded discards, then the joint search's friend call.
    CallOnly { worlds: usize },
}

fn exchange_actions(record: &Record) -> &[Action] {
    &record.log[record.exchange_at..record.play_at]
}

fn discards_of(actions: &[Action]) -> Vec<Card> {
    actions
        .iter()
        .filter_map(|a| match a {
            Action::Discard(c) => Some(*c),
            _ => None,
        })
        .collect()
}

pub fn exchange_variant(rules: &Rules, record: &Record, play: Actor, name: &str, how: Exchanger) -> ExchangeResult {
    let seats = rules.players;
    let mut state = replay(rules, record, record.exchange_at);
    let declarer = record.declarer;
    let mut log = Vec::new();
    let mut lab_rng = stream(record.deal, TAG_LAB, 7);
    match how {
        Exchanger::Bot(actor) => {
            let mut rngs = streams(record.deal, TAG_EXCHANGE, seats);
            advance(
                &mut state,
                &Table {
                    all: actor,
                    focus: None,
                },
                &mut rngs,
                &mut log,
                Phase::Exchange,
                &mut |_| {},
            );
        }
        Exchanger::Joint { worlds } => {
            for a in joint_exchange(&state, declarer, worlds, true, &mut lab_rng) {
                Mighty::apply(&mut state, a.clone()).expect("legal exchange");
                log.push(a);
            }
        }
        Exchanger::CallOnly { worlds } => {
            let recorded = exchange_actions(record);
            for a in &recorded[..recorded.len() - 1] {
                Mighty::apply(&mut state, a.clone()).expect("recorded");
                log.push(a.clone());
            }
            for a in joint_exchange(&state, declarer, worlds, false, &mut lab_rng) {
                Mighty::apply(&mut state, a.clone()).expect("legal exchange");
                log.push(a);
            }
        }
    }
    let contract = match Mighty::view(&state, Viewer::Spectator).phase {
        PhaseView::Play { contract, .. } => contract,
        other => panic!("exchange did not end: {other:?}"),
    };
    let call = match log.last() {
        Some(Action::CallFriend(c)) => *c,
        _ => panic!("no friend call"),
    };
    let mut rngs = streams(record.deal, TAG_PLAY, seats);
    advance(
        &mut state,
        &Table { all: play, focus: None },
        &mut rngs,
        &mut Vec::new(),
        Phase::Play,
        &mut |_| {},
    );
    let done = outcome(&state);
    ExchangeResult {
        deal: record.deal,
        variant: name.to_string(),
        contract,
        base_contract: record.contract,
        discards: discards_of(&log),
        base_discards: discards_of(exchange_actions(record)),
        call,
        base_call: record.call,
        payoff: done.payoffs[declarer],
        base: record.payoffs[declarer],
        team_points: done.team_points,
        base_team_points: record.team_points,
    }
}

/// Plays `actions` from `world`, then the friend call `call` (or the simple
/// bot's), then the hand out with simple bots: the declarer's payoff.
fn score_exchange(world: &State, actions: &[Action], call: Option<FriendCall>, me: Seat, rng: &mut ChaCha8Rng) -> i64 {
    let mut s = world.clone();
    for a in actions {
        if Mighty::apply(&mut s, a.clone()).is_err() {
            return i64::MIN / 4;
        }
    }
    let policy = SimpleBot::default();
    while phase(&s) == Phase::Exchange {
        let legal = Mighty::legal_actions(&s);
        let action = match call {
            Some(c) if legal.contains(&Action::CallFriend(c)) => Action::CallFriend(c),
            _ => {
                let view = Mighty::view(&s, Viewer::Seat(me));
                engine::Bot::act(&mut policy.clone(), &view, &legal, rng)
            }
        };
        Mighty::apply(&mut s, action).expect("legal");
    }
    playout(policy, s, me, rng)
}

/// Weighted mean of each candidate's payoffs over the same worlds.
fn means(scores: &[Vec<i64>], weights: &[f64]) -> Vec<f64> {
    scores
        .iter()
        .map(|s| s.iter().zip(weights).map(|(&x, w)| x as f64 * w).sum::<f64>() / weights.iter().sum::<f64>())
        .collect()
}

/// Searches the exchange from `state` (the declarer about to discard, or
/// about to call a friend when `discard` is false): every set of discards
/// among the cards worth considering, for the current trump and for any
/// trump the simple bot rates nearly as well, scored on sampled deals by
/// successive halving; then every sensible friend call. The actions to
/// take, in order.
pub fn joint_exchange(state: &State, me: Seat, worlds: usize, discard: bool, rng: &mut ChaCha8Rng) -> Vec<Action> {
    let view = Mighty::view(state, Viewer::Seat(me));
    let search = SearchBot::default();
    let sampled = search.worlds(&view, worlds, rng);
    let weights: Vec<f64> = sampled.iter().map(|w| w.1).collect();
    let policy = SimpleBot::default();
    let PhaseView::Exchange { contract, .. } = view.phase else {
        panic!("not exchanging");
    };
    let rules = &view.rules;
    let kitty = rules.kitty_size();
    let mut chosen: Vec<Action> = Vec::new();
    if discard {
        // The simple bot's own exchange, as the plan to beat.
        let mut usual = Vec::new();
        let mut s = state.clone();
        while phase(&s) == Phase::Exchange && discards_of(&usual).len() < kitty {
            let legal = Mighty::legal_actions(&s);
            let v = Mighty::view(&s, Viewer::Seat(me));
            let a = engine::Bot::act(&mut policy.clone(), &v, &legal, rng);
            Mighty::apply(&mut s, a.clone()).expect("legal");
            usual.push(a);
        }
        let mut plans: Vec<Vec<Action>> = vec![usual];
        let legal = Mighty::legal_actions(state);
        let current = policy.estimate(rules, &view.hand, contract.trump);
        let trumps = std::iter::once(None).chain(legal.iter().filter_map(|a| match a {
            Action::ChangeTrump(t) if t.is_some() && policy.estimate(rules, &view.hand, *t) >= current - 1.0 => {
                Some(Some(*t))
            }
            _ => None,
        }));
        for change in trumps {
            let trump = change.unwrap_or(contract.trump);
            let mighty = rules.mighty(trump);
            let keep = |c: &Card| {
                *c == mighty
                    || c.is_joker()
                    || (c.suit() == trump && trump.is_some() && c.rank() >= Some(ACE - 2))
                    || (c.rank() == Some(ACE))
            };
            let pool: Vec<Card> = view.hand.iter().copied().filter(|c| !keep(c)).collect();
            if pool.len() < kitty {
                continue;
            }
            let prefix: Vec<Action> = change.map(Action::ChangeTrump).into_iter().collect();
            for set in combinations(pool.len(), kitty) {
                let mut plan = prefix.clone();
                plan.extend(set.iter().map(|&i| Action::Discard(pool[i])));
                plans.push(plan);
            }
        }
        let best = halving(&sampled, &weights, &plans, me, rng);
        chosen = plans[best].clone();
    }
    // The friend call, on the chosen discards.
    let mut after = state.clone();
    for a in &chosen {
        Mighty::apply(&mut after, a.clone()).expect("legal");
    }
    let legal = Mighty::legal_actions(&after);
    let v = Mighty::view(&after, Viewer::Seat(me));
    let usual = engine::Bot::act(&mut policy.clone(), &v, &legal, rng);
    let PhaseView::Exchange { contract, .. } = v.phase else {
        panic!("still exchanging")
    };
    let trump = contract.trump;
    let mut wanted: Vec<Card> = vec![rules.mighty(trump)];
    wanted.extend(rules.deck.jokers());
    if let Some(t) = trump {
        wanted.extend((ACE - 4..=ACE).map(|r| Card::new(t, r)));
    }
    wanted.extend(
        Suit::ALL
            .into_iter()
            .filter(|&s| Some(s) != trump)
            .map(|s| Card::new(s, ACE)),
    );
    let mut calls: Vec<Action> = vec![usual.clone()];
    calls.extend(wanted.into_iter().map(|c| Action::CallFriend(FriendCall::Card(c))));
    calls.extend(
        [FriendCall::FirstTrick, FriendCall::LastTrick, FriendCall::Alone]
            .into_iter()
            .map(Action::CallFriend),
    );
    calls.retain(|a| legal.contains(a) && !matches!(a, Action::CallFriend(FriendCall::Card(c)) if v.hand.contains(c)));
    calls.dedup();
    if !calls.contains(&usual) {
        calls.insert(0, usual);
    }
    let plans: Vec<Vec<Action>> = calls
        .iter()
        .map(|c| chosen.iter().cloned().chain([c.clone()]).collect())
        .collect();
    let best = halving(&sampled, &weights, &plans, me, rng);
    plans[best].clone()
}

/// Successive halving over `plans` (each a list of exchange actions),
/// with plan 0 the default to beat: a plan replaces it only when ahead by
/// one standard error on the same deals.
fn halving(worlds: &[(State, f64)], weights: &[f64], plans: &[Vec<Action>], me: Seat, rng: &mut ChaCha8Rng) -> usize {
    let n = worlds.len();
    let mut alive: Vec<usize> = (0..plans.len()).collect();
    let mut used = (n / 8).max(16).min(n);
    let mut scores: Vec<Vec<i64>> = vec![Vec::new(); plans.len()];
    loop {
        for &p in &alive {
            let (actions, call) = split_call(&plans[p]);
            for (w, _) in worlds.iter().take(used).skip(scores[p].len()) {
                scores[p].push(score_exchange(w, &actions, call, me, rng));
            }
        }
        let m = means(
            &alive.iter().map(|&p| scores[p].clone()).collect::<Vec<_>>(),
            &weights[..used],
        );
        let mut order: Vec<(f64, usize)> = m.into_iter().zip(alive.iter().copied()).collect();
        order.sort_by(|a, b| b.0.total_cmp(&a.0));
        if used >= n {
            let best = order[0].1;
            if best == 0 || !alive.contains(&0) {
                return best;
            }
            // Beat the default by a standard error, deal by deal.
            let diffs: Vec<f64> = scores[best]
                .iter()
                .zip(&scores[0])
                .map(|(a, b)| (a - b) as f64)
                .collect();
            let w = &weights[..diffs.len()];
            let total: f64 = w.iter().sum();
            let mean = diffs.iter().zip(w).map(|(d, w)| d * w).sum::<f64>() / total;
            let ess = total * total / w.iter().map(|x| x * x).sum::<f64>();
            let var = diffs.iter().zip(w).map(|(d, w)| w * (d - mean).powi(2)).sum::<f64>() / total;
            let se = (var / ess.max(1.0)).sqrt();
            return if mean > se { best } else { 0 };
        }
        let keep = (order.len() / 3).clamp(2.min(order.len()), order.len());
        alive = order[..keep].iter().map(|o| o.1).collect();
        if !alive.contains(&0) {
            alive.push(0);
        }
        used = (used * 3).min(n);
    }
}

fn split_call(plan: &[Action]) -> (Vec<Action>, Option<FriendCall>) {
    match plan.last() {
        Some(Action::CallFriend(c)) => (plan[..plan.len() - 1].to_vec(), Some(*c)),
        _ => (plan.to_vec(), None),
    }
}

/// Every way to choose `k` of `n` indices.
fn combinations(n: usize, k: usize) -> Vec<Vec<usize>> {
    let mut out = Vec::new();
    let mut cur = Vec::new();
    fn go(start: usize, n: usize, k: usize, cur: &mut Vec<usize>, out: &mut Vec<Vec<usize>>) {
        if cur.len() == k {
            out.push(cur.clone());
            return;
        }
        for i in start..n {
            cur.push(i);
            go(i + 1, n, k, cur, out);
            cur.pop();
        }
    }
    go(0, n, k, &mut cur, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use mighty::rules::Preset;

    /// Replaying a recorded hand's play with the recorded bots reproduces it.
    #[test]
    fn replays_match_records() {
        let rules = Preset::Gshs.rules();
        let bot = Actor::parse("search:8:1:0").unwrap();
        for deal in 0..3 {
            let record = generate(&rules, deal, bot);
            let again = play_variant(&rules, &record, bot, 0, ("same", bot));
            assert_eq!(again.payoff, again.base);
            assert!(again.differing.is_empty());
            let ex = exchange_variant(&rules, &record, bot, "same", Exchanger::Bot(bot));
            assert_eq!(ex.payoff, ex.base);
        }
        assert_eq!(combinations(5, 2).len(), 10);
    }
}

/// Plays the recorded bots made that look wasteful in hindsight, from
/// the true cards; for finding blind spots in the rules the bots share.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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

pub fn audit(rules: &Rules, record: &Record) -> Audit {
    let mut a = Audit {
        deal: record.deal,
        ..Audit::default()
    };
    let mut state = replay(rules, record, record.play_at);
    let side = |s: Seat| s == record.declarer || record.friend == Some(s);
    for action in &record.log[record.play_at..] {
        let Turn::Seat(seat) = Mighty::turn(&state) else { break };
        let view = Mighty::view(&state, Viewer::Seat(seat));
        let legal = Mighty::legal_actions(&state);
        let PhaseView::Play {
            trick_no,
            plays,
            leading,
            contract,
            ..
        } = &view.phase
        else {
            break;
        };
        let (trick_no, leading) = (*trick_no, *leading);
        let Action::Play { card, call_joker, .. } = action else {
            break;
        };
        let card = *card;
        let mighty = rules.mighty(contract.trump);
        let points = plays.iter().filter(|p| p.card.is_point()).count();
        let partner_winning = leading.is_some_and(|w| side(w) == side(seat) && w != seat);
        let last = trick_no + 1 == rules.hand_size;
        let others: Vec<Card> = legal
            .iter()
            .filter_map(|l| match l {
                Action::Play { card: c, .. } if !c.is_joker() => Some(*c),
                _ => None,
            })
            .collect();
        let note = |what: &str, a: &mut Audit| {
            if a.examples.len() < 3 {
                a.examples.push(format!(
                    "deal {} trick {} seat {seat} ({}) {what}: played {card}, hand {}",
                    record.deal,
                    trick_no + 1,
                    if side(seat) { "attack" } else { "defence" },
                    view.hand.iter().map(|c| c.to_string()).collect::<Vec<_>>().join(" ")
                ));
            }
        };
        let choice = legal.len() > 1;
        if card.is_joker() && last {
            a.joker_on_last_trick += 1;
            note("joker kept to the last trick", &mut a);
        }
        if card.is_joker() && choice {
            if trick_no == 0 && !others.is_empty() {
                a.joker_powerless_by_choice += 1;
                note("powerless joker on trick 1", &mut a);
            }
            if partner_winning && !last {
                a.joker_on_partner += 1;
                note("joker on partner's trick", &mut a);
            }
        }
        if card == mighty && partner_winning && choice {
            a.mighty_on_partner += 1;
            note("mighty on partner's trick", &mut a);
        }
        if choice
            && (card == mighty || card.is_joker())
            && points == 0
            && !plays.is_empty()
            && trick_no + 3 < rules.hand_size
        {
            a.special_on_empty += 1;
        }
        let before = state.clone();
        Mighty::apply(&mut state, action.clone()).expect("recorded");
        if *call_joker {
            a.joker_calls += 1;
            if let PhaseView::Play {
                called_joker: Some(joker),
                ..
            } = Mighty::view(&state, Viewer::Spectator).phase
            {
                let holder = (0..rules.players).find(|&s| Mighty::view(&before, Viewer::Seat(s)).hand.contains(&joker));
                match holder {
                    Some(h) if h == seat => {
                        a.call_own_hand += 1;
                        note("called own joker", &mut a);
                    }
                    Some(h) if side(h) == side(seat) => {
                        a.call_own_side += 1;
                        note("called partner's joker", &mut a);
                    }
                    Some(_) => {}
                    None => {
                        a.call_discarded += 1;
                        note("called a joker already gone", &mut a);
                    }
                }
            }
        }
    }
    a
}

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
    /// The audit's flags on this play, if any.
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
pub fn regret(rules: &Rules, record: &Record, endgame: usize) -> RegretResult {
    let mut state = replay(rules, record, record.play_at);
    let side = |s: Seat| s == record.declarer || record.friend == Some(s);
    let policy = SimpleBot::default();
    let mut rng = stream(record.deal, TAG_LAB, 11);
    let mut decisions = Vec::new();
    for action in &record.log[record.play_at..] {
        let Turn::Seat(seat) = Mighty::turn(&state) else { break };
        let legal = Mighty::legal_actions(&state);
        let view = Mighty::view(&state, Viewer::Seat(seat));
        let PhaseView::Play {
            trick_no,
            plays,
            leading,
            contract,
            ..
        } = &view.phase
        else {
            break;
        };
        if legal.len() > 1 {
            let mut value = |a: &Action| {
                let mut s = state.clone();
                Mighty::apply(&mut s, a.clone()).expect("legal");
                finish(policy, endgame, s, seat, &mut rng)
            };
            let made = value(action);
            let (best_value, best) = legal
                .iter()
                .map(|a| (value(a), a))
                .max_by_key(|(v, _)| *v)
                .expect("a choice");
            let Action::Play { card, call_joker, .. } = action else {
                break;
            };
            let mighty = rules.mighty(contract.trump);
            let kind = if card.is_joker() {
                "joker"
            } else if *card == mighty {
                "mighty"
            } else if *call_joker {
                "call"
            } else if card.suit() == contract.trump && contract.trump.is_some() {
                "trump"
            } else {
                "plain"
            };
            let partner_winning = leading.is_some_and(|w| side(w) == side(seat) && w != seat);
            let points = plays.iter().filter(|p| p.card.is_point()).count();
            let mut flags = Vec::new();
            if partner_winning && (card.is_joker() || *card == mighty) && trick_no + 1 < rules.hand_size {
                flags.push(
                    if card.is_joker() {
                        "joker_on_partner"
                    } else {
                        "mighty_on_partner"
                    }
                    .to_string(),
                );
            }
            if (card.is_joker() || *card == mighty)
                && points == 0
                && !plays.is_empty()
                && trick_no + 3 < rules.hand_size
            {
                flags.push("special_on_empty".to_string());
            }
            if *call_joker {
                let called = rules
                    .deck
                    .jokers()
                    .iter()
                    .copied()
                    .find(|&j| rules.joker_call_card(j, contract.trump) == Some(*card));
                let holder = called.and_then(|j| {
                    (0..rules.players).find(|&s| Mighty::view(&state, Viewer::Seat(s)).hand.contains(&j))
                });
                match holder {
                    Some(h) if h == seat => flags.push("call_own_hand".to_string()),
                    Some(h) if side(h) == side(seat) => flags.push("call_own_side".to_string()),
                    _ => {}
                }
            }
            decisions.push(Regret {
                trick_no: *trick_no,
                seat,
                attacking: side(seat),
                leading: plays.is_empty(),
                kind: kind.to_string(),
                flags,
                regret: best_value - made,
                best: (best != action && best_value > made).then(|| best.clone()),
            });
        }
        Mighty::apply(&mut state, action.clone()).expect("recorded");
    }
    RegretResult {
        deal: record.deal,
        declarer: record.declarer,
        decisions,
    }
}
