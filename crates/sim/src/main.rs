use clap::{Parser, ValueEnum};
use engine::{Bot, RandomBot};
use mighty::bot::SimpleBot;
use mighty::rules::Preset;
use mighty::search::SearchBot;
use mighty::{Mighty, Options};
use sim::{Checks, Failure};
use std::process::ExitCode;
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

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
    /// `random`, `simple`, or `search[:SAMPLES[:CONFIDENCE]]` (bare
    /// `search` is the default search bot). `@name=value,...` after
    /// `simple` or `search` changes the simple bot's weights, e.g.
    /// `simple@bid_base=7` or `search:80@draw_trumps=3`.
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
        for setting in weights.split(',').filter(|w| !w.is_empty()) {
            let (key, value) = setting.split_once('=').ok_or(format!("bad weight {setting:?}"))?;
            set_weight(&mut policy, key, value)?;
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
            ..SearchBot::default()
        };
        if let Some(samples) = parts.next() {
            bot.samples = samples.parse().map_err(|_| format!("bad sample count in {s:?}"))?;
        }
        if let Some(confidence) = parts.next() {
            bot.confidence = confidence.parse().map_err(|_| format!("bad confidence in {s:?}"))?;
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
        "bid_mighty" => bot.bid_mighty = float()?,
        "bid_joker" => bot.bid_joker = float()?,
        "bid_ace" => bot.bid_ace = float()?,
        "bid_trump_honor" => bot.bid_trump_honor = float()?,
        "bid_king" => bot.bid_king = float()?,
        "bid_no_trump" => bot.bid_no_trump = float()?,
        "change_trump" => bot.change_trump = float()?,
        "alone" => bot.alone = float()?,
        "draw_trumps" => bot.draw_trumps = count()?,
        "late_tricks" => bot.late_tricks = count()?,
        "special_worth" => bot.special_worth = count()?,
        "lead_ace" => bot.lead_ace = int()?,
        "lead_point_penalty" => bot.lead_point_penalty = int()?,
        "lead_joker" => bot.lead_joker = int()?,
        "lead_mighty" => bot.lead_mighty = int()?,
        "defend_trump" => bot.defend_trump = int()?,
        "late_worth" => bot.late_worth = count()?,
        "call_joker_first" => bot.call_joker_first = value.parse().map_err(|_| bad())?,
        _ => return Err(format!("unknown weight {key:?}")),
    }
    Ok(())
}

/// The bots for one game, and the seat whose payoff is being measured.
fn table(args: &Args, seats: usize, game: u64, focus_bot: Spec) -> (Vec<Box<dyn Bot<Mighty>>>, Option<usize>) {
    // The first bidder is `game % seats`; cycling this separately covers
    // every pairing of measured seat and first bidder equally.
    let focus = matches!(args.bots, Bots::Search).then(|| (game as usize / seats) % seats);
    let bots = (0..seats)
        .map(|seat| match (args.bots, seat % 2) {
            _ if Some(seat) == focus => focus_bot.build(),
            (Bots::Search, _) => args.field.build(),
            (Bots::Random, _) | (Bots::Mixed, 1) => Box::new(RandomBot),
            _ => Box::new(SimpleBot::default()),
        })
        .collect();
    (bots, focus)
}

struct Outcome {
    steps: usize,
    focus_payoff: Option<f64>,
    baseline_payoff: Option<f64>,
}

/// Plays `args.games` games of `preset` on all workers.
fn run(args: &Args, preset: Preset) -> Result<Vec<Outcome>, Failure> {
    let rules = preset.rules();
    let seats = rules.players;
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
                        let options = Options {
                            rules: rules.clone(),
                            first_bidder: game as usize % seats,
                        };
                        let one = |focus_bot: Spec| {
                            let (mut bots, focus) = table(args, seats, game, focus_bot);
                            sim::play::<Mighty>(&options, &mut bots, args.seed + game, checks).map(|report| Outcome {
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
            print!(" ({:.0} s)", started.elapsed().as_secs_f64());
        }
        println!();
    }
    ExitCode::SUCCESS
}
