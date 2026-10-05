use clap::{Parser, ValueEnum};
use engine::{Bot, RandomBot};
use mighty::bot::SimpleBot;
use mighty::rules::Preset;
use mighty::{Mighty, Options};
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;
use sim::spec::Spec;
use sim::stats::{mean_and_margin, quantile};
use sim::{Checks, Clock, Failure, Timed};
use std::cell::RefCell;
use std::process::ExitCode;
use std::rc::Rc;
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
    /// `random`, `simple`, or `search[:SAMPLES[:CONFIDENCE[:BUDGET_MS]]]`
    /// (bare `search` is the default search bot; a budget of 0 turns the
    /// time limit off, which keeps runs reproducible). `@name=value,...`
    /// after `simple` or `search` changes the simple bot's weights, e.g.
    /// `simple@bid_base=7` or `search:80@draw_trumps=3`; for `simple`,
    /// `slips=P` plays a random card with probability P; for `search`,
    /// `read.NAME=value` changes how it reads the other players, e.g.
    /// `search@read.on=false`, `threads=N` splits each search across N
    /// threads, and `endgame=N` solves the last N tricks of each playout.
    /// `easy`, `normal` and `hard` are the table's 초보, 보통 and 고수
    /// (`hard` is `search:200:1:0`, without the table's time limit), each
    /// bidding a little bolder or more carefully by seat as at the table.
    /// `belief:MODEL_DIR:SAMPLES` is `hard` at SAMPLES deals, dealing the
    /// unseen cards by the belief model in MODEL_DIR instead of reading
    /// the table (built with `--features belief`). `dmc:MODEL_DIR[:TEMP]`
    /// plays by the Q network in MODEL_DIR, greedily or at a temperature
    /// in points (built with `--features dmc`).
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

/// The bots for one game, and the seat whose payoff is being measured.
fn table(
    args: &Args,
    seats: usize,
    game: u64,
    focus_bot: Spec,
    clock: &Rc<RefCell<Clock>>,
) -> (Vec<Box<dyn Bot<Mighty>>>, Option<usize>) {
    // The first bidder is `game % seats`; cycling this separately covers
    // every pairing of measured seat and first bidder equally.
    let focus = matches!(args.bots, Bots::Search).then(|| (game as usize / seats) % seats);
    let bots = (0..seats)
        .map(|seat| -> Box<dyn Bot<Mighty>> {
            match (args.bots, seat % 2) {
                _ if Some(seat) == focus => Box::new(Timed {
                    bot: focus_bot.build(seat),
                    clock: clock.clone(),
                }),
                (Bots::Search, _) => args.field.build(seat),
                (Bots::Random, _) | (Bots::Mixed, 1) => Box::new(RandomBot),
                _ => Box::new(SimpleBot::default()),
            }
        })
        .collect();
    (bots, focus)
}

struct Outcome {
    clock: Clock,
    baseline_clock: Clock,
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
    let checks = Checks {
        view_every: args.view_every,
        ..Checks::default()
    };
    sim::parallel(args.games, args.threads, |game| {
        let rules = if args.vary {
            rules.varied(&mut ChaCha8Rng::seed_from_u64(args.seed + game))
        } else {
            rules.clone()
        };
        let seats = rules.players;
        let options = Options {
            rules,
            first_bidder: game as usize % seats,
        };
        let one = |focus_bot: Spec| {
            let clock = Rc::new(RefCell::new(Clock::default()));
            let (mut bots, focus) = table(args, seats, game, focus_bot, &clock);
            sim::play::<Mighty>(&options, &mut bots, args.seed + game, checks).map(|report| Outcome {
                clock: clock.take(),
                baseline_clock: Clock::default(),
                steps: report.steps,
                focus_payoff: focus.map(|seat| report.payoffs[seat] as f64),
                baseline_payoff: None,
            })
        };
        one(args.focus).and_then(|mut outcome| {
            if let Some(baseline) = args.baseline {
                let base = one(baseline)?;
                outcome.baseline_payoff = base.focus_payoff;
                outcome.baseline_clock = base.clock;
            }
            Ok(outcome)
        })
    })
    .into_iter()
    .collect()
}

/// Median, 99th percentile and slowest decision, in milliseconds.
fn timing<'a>(clocks: impl Iterator<Item = &'a Clock>) -> String {
    let mut ms: Vec<f64> = clocks
        .flat_map(|c| &c.times)
        .map(|t| t.as_secs_f64() * 1000.0)
        .collect();
    if ms.is_empty() {
        return "nothing".into();
    }
    ms.sort_by(f64::total_cmp);
    format!(
        "median {:.1} ms, p99 {:.0} ms, at most {:.0} ms per decision",
        quantile(&ms, 0.5),
        quantile(&ms, 0.99),
        ms[ms.len() - 1]
    )
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
            print!(", thinking {}", timing(outcomes.iter().map(|o| &o.clock)));
            if args.baseline.is_some() {
                print!(" (baseline {})", timing(outcomes.iter().map(|o| &o.baseline_clock)));
            }
            print!(" ({:.0} s)", started.elapsed().as_secs_f64());
        }
        println!();
    }
    ExitCode::SUCCESS
}
