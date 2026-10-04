use clap::{Parser, ValueEnum};
use engine::{Bot, RandomBot};
use mighty::bot::SimpleBot;
use mighty::rules::{BackRun, Doubling, Preset, Rules, Scoring, WinScore};
use mighty::search::{Reading, SearchBot};
use mighty::{Action, Mighty, Options, View};
use rand::{Rng, RngCore, SeedableRng};
use rand_chacha::ChaCha8Rng;
use sim::{Checks, Failure};
use std::cell::Cell;
use std::process::ExitCode;
use std::rc::Rc;
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// Play many Mighty games with bots, checking every invariant after each step.
#[derive(Parser)]
struct Args {
    /// House rules to play; all presets when omitted.
    #[arg(long)]
    preset: Option<Preset>,
    /// Games per preset.
    #[arg(long, default_value_t = 1000)]
    games: u64,
    #[arg(long, default_value_t = 0)]
    seed: u64,
    #[arg(long, value_enum, default_value_t = Bots::Mixed)]
    bots: Bots,
    /// With `--bots search`: the measured bot, moving one seat each game.
    /// `random`, `simple`, or `search[:SAMPLES[:CONFIDENCE[:BUDGET_MS]]]`
    /// (bare `search` is the default search bot; a budget of 0 turns the
    /// time limit off, which keeps runs reproducible). `@name=value,...`
    /// after `simple` or `search` changes the simple bot's weights, e.g.
    /// `simple@bid_base=7` or `search:80@draw_trumps=3`; for `search`,
    /// `read.NAME=value` changes how it reads the other players, e.g.
    /// `search@read.on=false`, and `threads=N` splits each search across N
    /// threads.
    #[arg(long, default_value = "search")]
    focus: Spec,
    /// With `--bots search`: the bot in every other seat.
    #[arg(long, default_value = "simple")]
    field: Spec,
    /// With `--bots search`: also play every game with this bot in the
    /// focus seat, on the same cards, and report how much better the focus
    /// bot did. Pairing removes most of the luck of the deal.
    #[arg(long)]
    baseline: Option<Spec>,
    /// Check that views hide what they should every this many steps; 0
    /// skips the check, which speeds up long tuning runs.
    #[arg(long, default_value_t = 1)]
    view_every: usize,
    /// Worker threads; all cores when omitted.
    #[arg(long)]
    threads: Option<usize>,
    /// Play the preset for this many players (3 to 7), as
    /// `Rules::for_players` adapts it.
    #[arg(long)]
    players: Option<usize>,
    /// Give every game a random mix of the optional rules (misdeal,
    /// bidding, scoring and player-count variants) on top of the preset.
    #[arg(long)]
    vary: bool,
}

/// The preset's rules with the optional rules drawn at random for one game.
fn vary(rules: &Rules, seed: u64) -> Rules {
    let mut rng = ChaCha8Rng::seed_from_u64(seed);
    let mut r = rules.for_players(rng.random_range(3..=7)).expect("3 to 7 players");
    r.misdeal.all_points = rng.random();
    r.misdeal.after_bidding = rng.random();
    r.misdeal.declarer = rng.random();
    r.bidding.pass_is_final = rng.random();
    r.bidding.change_to_no_trump_cost = [None, Some(0), Some(1), Some(2)][rng.random_range(0..4)];
    let doubling = |rng: &mut ChaCha8Rng| [Doubling::Never, Doubling::Win, Doubling::Always][rng.random_range(0..3)];
    r.scoring = Scoring {
        win: [
            WinScore::OverTen,
            WinScore::OverMin,
            WinScore::OverBid,
            WinScore::BidBonus,
        ][rng.random_range(0..4)],
        no_trump: doubling(&mut rng),
        alone: doubling(&mut rng),
        run: rng.random(),
        back_run: match rng.random_range(0..4) {
            0 => BackRun::Never,
            1 => BackRun::TeamAtMost(rng.random_range(8..=10)),
            2 => BackRun::ShortBy(rng.random_range(3..=6)),
            _ => BackRun::DefenceReachesBid,
        },
        discards_to_declarer: rng.random(),
    };
    r.validate().expect("varied rules are valid");
    r
}

#[derive(Clone, Copy, ValueEnum)]
enum Bots {
    Random,
    Simple,
    /// Alternate simple and random bots around the table.
    Mixed,
    /// One `--focus` bot against `--field` bots. Reports the focus bot's
    /// average payoff; above zero means it is stronger.
    Search,
}

#[derive(Clone, Copy, Debug)]
enum Spec {
    Random,
    Simple(SimpleBot),
    Search(SearchBot),
}

impl FromStr for Spec {
    type Err = String;

    fn from_str(s: &str) -> Result<Spec, String> {
        let (name, weights) = s.split_once('@').unwrap_or((s, ""));
        let mut policy = SimpleBot::default();
        let mut reading = Reading::default();
        let mut search_threads = 1;
        for setting in weights.split(',').filter(|w| !w.is_empty()) {
            let (key, value) = setting.split_once('=').ok_or(format!("bad weight {setting:?}"))?;
            match key.strip_prefix("read.") {
                Some(key) if name.starts_with("search") => set_reading(&mut reading, key, value)?,
                None if key == "threads" && name.starts_with("search") => {
                    search_threads = value.parse().map_err(|_| format!("bad value {value:?} for threads"))?;
                }
                _ => set_weight(&mut policy, key, value)?,
            }
        }
        match name {
            "random" => return Ok(Spec::Random),
            "simple" => return Ok(Spec::Simple(policy)),
            _ => {}
        }
        let mut parts = name.split(':');
        if parts.next() != Some("search") {
            return Err(format!("unknown bot {s:?}"));
        }
        let mut bot = SearchBot {
            policy,
            reading,
            threads: search_threads,
            ..SearchBot::default()
        };
        if let Some(samples) = parts.next() {
            bot.samples = samples.parse().map_err(|_| format!("bad sample count in {s:?}"))?;
        }
        if let Some(confidence) = parts.next() {
            bot.confidence = confidence.parse().map_err(|_| format!("bad confidence in {s:?}"))?;
        }
        if let Some(budget) = parts.next() {
            let ms: u64 = budget.parse().map_err(|_| format!("bad budget in {s:?}"))?;
            bot.budget = (ms > 0).then(|| Duration::from_millis(ms));
        }
        Ok(Spec::Search(bot))
    }
}

impl Spec {
    fn build(self) -> Box<dyn Bot<Mighty>> {
        match self {
            Spec::Random => Box::new(RandomBot),
            Spec::Simple(bot) => Box::new(bot),
            Spec::Search(bot) => Box::new(bot),
        }
    }
}

/// Sets one of the simple bot's weights by name, for tuning from the
/// command line.
fn set_weight(bot: &mut SimpleBot, key: &str, value: &str) -> Result<(), String> {
    let bad = || format!("bad value {value:?} for {key}");
    let float = || value.parse::<f32>().map_err(|_| bad());
    let int = || value.parse::<i32>().map_err(|_| bad());
    let count = || value.parse::<usize>().map_err(|_| bad());
    match key {
        "bid_base" => bot.bid_base = float()?,
        "bid_trump" => bot.bid_trump = float()?,
        "bid_trump_honor" => bot.bid_trump_honor = float()?,
        "bid_mighty" => bot.bid_mighty = float()?,
        "bid_joker" => bot.bid_joker = float()?,
        "bid_sub_joker" => bot.bid_sub_joker = float()?,
        "bid_ace" => bot.bid_ace = float()?,
        "bid_king" => bot.bid_king = float()?,
        "change_trump" => bot.change_trump = float()?,
        "draw_trumps" => bot.draw_trumps = count()?,
        "late_tricks" => bot.late_tricks = count()?,
        "special_worth" => bot.special_worth = count()?,
        "lead_point_penalty" => bot.lead_point_penalty = int()?,
        "lead_joker" => bot.lead_joker = int()?,
        "lead_mighty" => bot.lead_mighty = int()?,
        "defend_trump" => bot.defend_trump = int()?,
        "plan_last_trick" => bot.plan_last_trick = value.parse().map_err(|_| bad())?,
        _ => return Err(format!("unknown weight {key:?}")),
    }
    Ok(())
}

/// Sets how the search bot reads the other players, for tuning from the
/// command line: `read.on`, `read.slip`, `read.bid_scale`, `read.min_share`, `read.draws`.
fn set_reading(reading: &mut Reading, key: &str, value: &str) -> Result<(), String> {
    let bad = || format!("bad value {value:?} for read.{key}");
    let float = || value.parse::<f64>().map_err(|_| bad());
    match key {
        "on" => reading.on = value.parse().map_err(|_| bad())?,
        "slip" => reading.slip = float()?,
        "bid_scale" => reading.bid_scale = float()?,
        "min_share" => reading.min_share = float()?,
        "draws" => reading.draws = value.parse().map_err(|_| bad())?,
        _ => return Err(format!("unknown setting read.{key}")),
    }
    Ok(())
}

/// The bots for one game, and the seat whose payoff is being measured.
fn table(
    args: &Args,
    seats: usize,
    game: u64,
    focus_bot: Spec,
    clock: &Rc<Cell<Clock>>,
) -> (Vec<Box<dyn Bot<Mighty>>>, Option<usize>) {
    // The first bidder is `game % seats`; cycling this separately covers
    // every pairing of measured seat and first bidder equally.
    let focus = matches!(args.bots, Bots::Search).then(|| (game as usize / seats) % seats);
    let bots = (0..seats)
        .map(|seat| match (args.bots, seat % 2) {
            _ if Some(seat) == focus => Box::new(Timed {
                bot: focus_bot.build(),
                clock: clock.clone(),
            }),
            (Bots::Search, _) => args.field.build(),
            (Bots::Random, _) | (Bots::Mixed, 1) => Box::new(RandomBot),
            _ => Box::new(SimpleBot::default()),
        })
        .collect();
    (bots, focus)
}

/// Thinking time of the focus bot.
#[derive(Debug, Clone, Copy, Default)]
struct Clock {
    total: Duration,
    decisions: u32,
    slowest: Duration,
}

/// Times every decision of the bot it wraps.
struct Timed {
    bot: Box<dyn Bot<Mighty>>,
    clock: Rc<Cell<Clock>>,
}

impl Bot<Mighty> for Timed {
    fn act(&mut self, view: &View, legal: &[Action], rng: &mut dyn RngCore) -> Action {
        let started = Instant::now();
        let action = self.bot.act(view, legal, rng);
        let took = started.elapsed();
        let mut clock = self.clock.get();
        clock.total += took;
        clock.decisions += 1;
        clock.slowest = clock.slowest.max(took);
        self.clock.set(clock);
        action
    }
}

struct Outcome {
    clock: Clock,
    steps: usize,
    focus_payoff: Option<f64>,
    baseline_payoff: Option<f64>,
}

/// Plays `args.games` games of `preset` on all workers.
fn run(args: &Args, preset: Preset) -> Result<Vec<Outcome>, Failure> {
    let mut rules = preset.rules();
    if let Some(players) = args.players {
        rules = rules.for_players(players).ok_or_else(|| Failure {
            seed: args.seed,
            step: 0,
            message: format!("no rules for {players} players"),
            last_actions: Vec::new(),
        })?;
    }
    let next = AtomicU64::new(0);
    let checks = Checks {
        view_every: args.view_every,
        ..Checks::default()
    };
    let threads = args
        .threads
        .unwrap_or_else(|| std::thread::available_parallelism().map_or(1, |n| n.get()));
    let mut results: Vec<(u64, Result<Outcome, Failure>)> = std::thread::scope(|scope| {
        let workers: Vec<_> = (0..threads)
            .map(|_| {
                scope.spawn(|| {
                    let mut done = Vec::new();
                    loop {
                        let game = next.fetch_add(1, Ordering::Relaxed);
                        if game >= args.games {
                            return done;
                        }
                        let rules = if args.vary {
                            vary(&rules, args.seed + game)
                        } else {
                            rules.clone()
                        };
                        let seats = rules.players;
                        let options = Options {
                            rules,
                            first_bidder: game as usize % seats,
                        };
                        let one = |focus_bot: Spec| {
                            let clock = Rc::new(Cell::new(Clock::default()));
                            let (mut bots, focus) = table(args, seats, game, focus_bot, &clock);
                            sim::play::<Mighty>(&options, &mut bots, args.seed + game, checks).map(|report| Outcome {
                                clock: clock.get(),
                                steps: report.steps,
                                focus_payoff: focus.map(|seat| report.payoffs[seat] as f64),
                                baseline_payoff: None,
                            })
                        };
                        let outcome = one(args.focus).and_then(|mut outcome| {
                            if let Some(baseline) = args.baseline {
                                outcome.baseline_payoff = one(baseline)?.focus_payoff;
                            }
                            Ok(outcome)
                        });
                        done.push((game, outcome));
                    }
                })
            })
            .collect();
        workers
            .into_iter()
            .flat_map(|w| w.join().expect("worker panicked"))
            .collect()
    });
    results.sort_by_key(|(game, _)| *game);
    results.into_iter().map(|(_, r)| r).collect()
}

/// The mean, and the half-width of its 95% confidence interval.
fn mean_and_margin(xs: &[f64]) -> (f64, f64) {
    let n = xs.len() as f64;
    let mean = xs.iter().sum::<f64>() / n;
    let var = xs.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (n - 1.0).max(1.0);
    (mean, 1.96 * (var / n).sqrt())
}

fn main() -> ExitCode {
    let args = Args::parse();
    let presets = args.preset.map_or(Preset::ALL.to_vec(), |p| vec![p]);
    for preset in presets {
        let started = Instant::now();
        let outcomes = match run(&args, preset) {
            Ok(outcomes) => outcomes,
            Err(failure) => {
                eprintln!("{preset}: {failure}");
                return ExitCode::FAILURE;
            }
        };
        let steps: usize = outcomes.iter().map(|o| o.steps).sum();
        let per_game = steps as f64 / args.games as f64;
        print!("{preset:>8}: {} games ok, {per_game:.1} steps per game", args.games);
        let focus: Vec<f64> = outcomes.iter().filter_map(|o| o.focus_payoff).collect();
        if !focus.is_empty() {
            let (mean, margin) = mean_and_margin(&focus);
            print!(", focus bot averages {mean:+.2} ± {margin:.2} per hand");
        }
        let gains: Vec<f64> = outcomes
            .iter()
            .filter_map(|o| Some(o.focus_payoff? - o.baseline_payoff?))
            .collect();
        if !gains.is_empty() {
            let (mean, margin) = mean_and_margin(&gains);
            print!(", {mean:+.3} ± {margin:.3} over the baseline");
        }
        if !focus.is_empty() {
            let total: Duration = outcomes.iter().map(|o| o.clock.total).sum();
            let decisions: u32 = outcomes.iter().map(|o| o.clock.decisions).sum();
            let slowest = outcomes.iter().map(|o| o.clock.slowest).max().unwrap_or_default();
            print!(
                ", thinking {:.1} ms per decision, at most {:.0} ms ({:.0} s)",
                total.as_secs_f64() * 1000.0 / f64::from(decisions.max(1)),
                slowest.as_secs_f64() * 1000.0,
                started.elapsed().as_secs_f64()
            );
        }
        println!();
    }
    ExitCode::SUCCESS
}
