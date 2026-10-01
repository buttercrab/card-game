use clap::{Parser, ValueEnum};
use engine::{Bot, RandomBot};
use mighty::bot::SimpleBot;
use mighty::rules::Preset;
use mighty::search::SearchBot;
use mighty::{Mighty, Options};
use sim::Checks;
use std::process::ExitCode;
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
    /// Deals the search bot samples per decision.
    #[arg(long, default_value_t = SearchBot::default().samples)]
    samples: usize,
}

#[derive(Clone, Copy, ValueEnum)]
enum Bots {
    Random,
    Simple,
    /// Alternate simple and random bots around the table.
    Mixed,
    /// One search bot, moving one seat each game, against simple bots.
    /// Reports the search bot's average payoff; above zero means stronger.
    Search,
}

/// The bots for one game, and the seat whose payoff is being measured.
fn table(args: &Args, seats: usize, game: u64) -> (Vec<Box<dyn Bot<Mighty>>>, Option<usize>) {
    // The first bidder is `game % seats`; cycling this separately covers
    // every pairing of measured seat and first bidder equally.
    let focus = matches!(args.bots, Bots::Search).then(|| (game as usize / seats) % seats);
    let bots = (0..seats)
        .map(|seat| -> Box<dyn Bot<Mighty>> {
            match (args.bots, seat % 2) {
                _ if Some(seat) == focus => Box::new(SearchBot { samples: args.samples }),
                (Bots::Random, _) | (Bots::Mixed, 1) => Box::new(RandomBot),
                _ => Box::new(SimpleBot),
            }
        })
        .collect();
    (bots, focus)
}

fn main() -> ExitCode {
    let args = Args::parse();
    let presets = args.preset.map_or(Preset::ALL.to_vec(), |p| vec![p]);
    for preset in presets {
        let rules = preset.rules();
        let seats = rules.players;
        let mut steps = 0;
        let mut focus_payoffs: Vec<f64> = Vec::new();
        let started = Instant::now();
        for game in 0..args.games {
            let seed = args.seed + game;
            let options = Options {
                rules: rules.clone(),
                first_bidder: game as usize % seats,
            };
            let (mut bots, focus) = table(&args, seats, game);
            match sim::play::<Mighty>(&options, &mut bots, seed, Checks::default()) {
                Ok(report) => {
                    steps += report.steps;
                    if let Some(seat) = focus {
                        focus_payoffs.push(report.payoffs[seat] as f64);
                    }
                }
                Err(failure) => {
                    eprintln!("{preset}: {failure}");
                    return ExitCode::FAILURE;
                }
            }
        }
        let per_game = steps as f64 / args.games as f64;
        print!("{preset:>8}: {} games ok, {per_game:.1} steps per game", args.games);
        if !focus_payoffs.is_empty() {
            let n = focus_payoffs.len() as f64;
            let mean = focus_payoffs.iter().sum::<f64>() / n;
            let var = focus_payoffs.iter().map(|p| (p - mean).powi(2)).sum::<f64>() / (n - 1.0).max(1.0);
            let margin = 1.96 * (var / n).sqrt();
            let ms = started.elapsed().as_secs_f64() * 1000.0 / n;
            print!(", search bot averages {mean:+.2} ± {margin:.2} per hand ({ms:.0} ms per game)");
        }
        println!();
    }
    ExitCode::SUCCESS
}
