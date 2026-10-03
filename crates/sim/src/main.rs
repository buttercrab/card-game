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
    /// `search` is the default search bot).
    #[arg(long, default_value = "search")]
    focus: Spec,
    /// With `--bots search`: the bot in every other seat.
    #[arg(long, default_value = "simple")]
    field: Spec,
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
    Simple,
    Search(SearchBot),
}

impl FromStr for Spec {
    type Err = String;

    fn from_str(s: &str) -> Result<Spec, String> {
        match s {
            "random" => return Ok(Spec::Random),
            "simple" => return Ok(Spec::Simple),
            "search" => return Ok(Spec::Search(SearchBot::default())),
            _ => {}
        }
        let rest = s.strip_prefix("search:").ok_or(format!("unknown bot {s:?}"))?;
        let mut parts = rest.split(':');
        let mut bot = SearchBot::default();
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
            Spec::Simple => Box::new(SimpleBot),
            Spec::Search(bot) => Box::new(bot),
        }
    }
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
            _ => Box::new(SimpleBot),
        })
        .collect();
    (bots, focus)
}

struct Outcome {
    steps: usize,
    focus_payoff: Option<f64>,
}

/// Plays `args.games` games of `preset` on all workers.
fn run(args: &Args, preset: Preset) -> Result<Vec<Outcome>, Failure> {
    let rules = preset.rules();
    let seats = rules.players;
    let next = AtomicU64::new(0);
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
                            sim::play::<Mighty>(&options, &mut bots, args.seed + game, Checks::default()).map(
                                |report| Outcome {
                                    steps: report.steps,
                                    focus_payoff: focus.map(|seat| report.payoffs[seat] as f64),
                                },
                            )
                        };
                        done.push((game, one(args.focus)));
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
            let n = focus.len() as f64;
            let mean = focus.iter().sum::<f64>() / n;
            let var = focus.iter().map(|p| (p - mean).powi(2)).sum::<f64>() / (n - 1.0).max(1.0);
            let margin = 1.96 * (var / n).sqrt();
            let secs = started.elapsed().as_secs_f64();
            print!(", focus bot averages {mean:+.2} ± {margin:.2} per hand ({secs:.0} s)");
        }
        println!();
    }
    ExitCode::SUCCESS
}
