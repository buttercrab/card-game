//! A belief model against what the search believes now: on hands of the
//! table's 고수 in every seat, at every decision, the log-loss of where
//! each hidden card really is under
//!
//! - **counts**: each hidden card in a place in proportion to how many
//!   hidden cards it holds (the baseline the model is trained against);
//! - **dealer**: the search's own deals, uniform but for voids and the
//!   bidding-consistency redeals ([`SearchBot::worlds`] without reading);
//! - **reading**: the same weighed by how well each deal explains the
//!   other players' bids and plays (the table's 고수 as it plays);
//! - **model**: the belief model;
//! - **model deals** and **model + reading**: the search's deals and
//!   reading, dealing by the model ([`Sampler::Belief`]), as the belief
//!   bot does with reading off and on.
//!
//! The search's beliefs are the shares of `--worlds` sampled worlds, mixed
//! with 2% of the counts so that a card no world put somewhere costs a
//! finite loss.
//!
//! ```sh
//! cargo run --release -p infer --example beliefs -- <model dir> --rules gshs --hands 100
//! cargo run --release -p infer --example beliefs -- <model dir> --rules research/evals/v1/heldout-rules.json
//! ```

use clap::Parser;
use engine::{Bot, Encode, Game, Turn, Viewer};
use infer::BeliefNet;
use mighty::rules::{Preset, Rules};
use mighty::{Mighty, Options, PhaseView};
use mighty_ai::{Reading, Sampler, SearchBot};
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Parser)]
struct Args {
    /// An exported model directory.
    model: PathBuf,
    /// A preset, or a JSON array of rule sets played in turn.
    #[arg(long, default_value = "gshs")]
    rules: String,
    #[arg(long, default_value_t = 60)]
    hands: u64,
    /// Worlds the search samples for its beliefs.
    #[arg(long, default_value_t = 200)]
    worlds: usize,
    #[arg(long, default_value_t = 0)]
    seed: u64,
    #[arg(long, default_value_t = 8)]
    threads: u64,
}

const PREDICTORS: [&str; N] = ["counts", "dealer", "reading", "model", "model deals", "model + reading"];
const N: usize = 6;
const PHASES: [&str; 4] = ["bidding", "exchange", "early tricks", "late tricks"];
const CLASSES: usize = 9;
const SMOOTHING: f64 = 0.02;

/// Summed negative log-likelihoods and hits, per phase and predictor.
#[derive(Default, Clone)]
struct Tally {
    cards: [usize; 4],
    loss: [[f64; N]; 4],
    hits: [[usize; N]; 4],
}

impl Tally {
    fn add(&mut self, other: &Tally) {
        for p in 0..4 {
            self.cards[p] += other.cards[p];
            for k in 0..N {
                self.loss[p][k] += other.loss[p][k];
                self.hits[p][k] += other.hits[p][k];
            }
        }
    }
}

/// Per hidden card, the share of `worlds`' weight with it in each class.
fn shares(worlds: &[(mighty::State, f64)], seat: usize) -> Vec<[f64; CLASSES]> {
    let mut out = vec![[0.0; CLASSES]; 54];
    for (world, weight) in worlds {
        for (card, &class) in Mighty::belief_targets(world, seat).iter().enumerate() {
            if class >= 0 {
                out[card][class as usize] += weight;
            }
        }
    }
    out
}

fn play(args: &Args, net: &Arc<BeliefNet>, rules: &[Rules], hands: impl Iterator<Item = u64>) -> Tally {
    let mut tally = Tally::default();
    let hard = SearchBot {
        samples: 200,
        budget: None,
        ..SearchBot::default()
    };
    let dealer = SearchBot {
        reading: Reading {
            on: false,
            ..Reading::default()
        },
        ..hard.clone()
    };
    let (believer, believer_reading) = (
        SearchBot {
            sampler: Sampler::Belief(net.clone()),
            ..dealer.clone()
        },
        SearchBot {
            sampler: Sampler::Belief(net.clone()),
            ..hard.clone()
        },
    );
    for hand in hands {
        let rules = rules[hand as usize % rules.len()].clone();
        let players = rules.players;
        let options = Options {
            rules,
            first_bidder: hand as usize % players,
        };
        let mut rng = ChaCha8Rng::seed_from_u64(args.seed + hand);
        let mut state = Mighty::new_game(&options).expect("valid rules");
        let mut bots = vec![hard.clone(); players];
        loop {
            let action = match Mighty::turn(&state) {
                Turn::Over => break,
                Turn::Chance => Mighty::sample_chance(&state, &mut rng),
                Turn::Seat(seat) => {
                    let view = Mighty::view(&state, Viewer::Seat(seat));
                    let legal = Mighty::legal_actions(&state);
                    let phase = match &view.phase {
                        PhaseView::Bidding { .. } => Some(0),
                        PhaseView::Exchange { .. } => Some(1),
                        PhaseView::Play { trick_no, .. } => {
                            Some(if 2 * trick_no < view.rules.hand_size { 2 } else { 3 })
                        }
                        _ => None,
                    };
                    if let Some(phase) = phase {
                        let truth = Mighty::belief_targets(&state, seat);
                        let mut counts = [0.0f64; CLASSES];
                        for &c in truth.iter().filter(|&&c| c >= 0) {
                            counts[c as usize] += 1.0;
                        }
                        let total: f64 = counts.iter().sum();
                        let obs = Mighty::encode(&view, &legal);
                        let logits = &net.run(&[&obs]).expect("the model runs")[0];
                        let dealt = shares(&dealer.worlds(&view, args.worlds, &mut rng), seat);
                        let read = shares(&hard.worlds(&view, args.worlds, &mut rng), seat);
                        let believed = shares(&believer.worlds(&view, args.worlds, &mut rng), seat);
                        let believed_read = shares(&believer_reading.worlds(&view, args.worlds, &mut rng), seat);
                        for (card, &class) in truth.iter().enumerate() {
                            if class < 0 {
                                continue;
                            }
                            let prior: Vec<f64> = counts.iter().map(|c| c / total).collect();
                            let model: Vec<f64> = {
                                let row = &logits[card * CLASSES..(card + 1) * CLASSES];
                                let w: Vec<f64> = (0..CLASSES).map(|k| counts[k] * f64::from(row[k]).exp()).collect();
                                let sum: f64 = w.iter().sum();
                                w.iter().map(|x| x / sum).collect()
                            };
                            let mix = |s: &[f64; CLASSES]| -> Vec<f64> {
                                let sum: f64 = s.iter().sum::<f64>().max(1e-12);
                                (0..CLASSES)
                                    .map(|k| (1.0 - SMOOTHING) * s[k] / sum + SMOOTHING * prior[k])
                                    .collect()
                            };
                            let predictions = [
                                prior.clone(),
                                mix(&dealt[card]),
                                mix(&read[card]),
                                model,
                                mix(&believed[card]),
                                mix(&believed_read[card]),
                            ];
                            tally.cards[phase] += 1;
                            for (k, p) in predictions.iter().enumerate() {
                                tally.loss[phase][k] -= p[class as usize].ln();
                                let best = (0..CLASSES).max_by(|&a, &b| p[a].total_cmp(&p[b])).unwrap();
                                tally.hits[phase][k] += usize::from(best == class as usize);
                            }
                        }
                    }
                    bots[seat].act(&view, &legal, &mut rng)
                }
            };
            Mighty::apply(&mut state, action).expect("legal");
        }
    }
    tally
}

fn main() {
    let args = Args::parse();
    let net = Arc::new(BeliefNet::open(&args.model).expect("a model directory"));
    let rules: Vec<Rules> = match args.rules.parse::<Preset>() {
        Ok(preset) => vec![preset.rules()],
        Err(_) => serde_json::from_str(&std::fs::read_to_string(&args.rules).expect("a rules file"))
            .expect("a JSON array of rule sets"),
    };
    // A model reads the encoding it was trained on, and no other.
    let spec = Mighty::spec(&Options {
        rules: rules[0].clone(),
        first_bidder: 0,
    })
    .expect("rules the encoding takes");
    assert!(
        net.spec() == &spec,
        "the model reads {}, not {}",
        net.spec().version,
        spec.version
    );
    let total = std::thread::scope(|scope| {
        let workers: Vec<_> = (0..args.threads)
            .map(|t| {
                let (args, rules, net) = (&args, &rules, &net);
                scope.spawn(move || play(args, net, rules, (t..args.hands).step_by(args.threads as usize)))
            })
            .collect();
        let mut total = Tally::default();
        for worker in workers {
            total.add(&worker.join().expect("a worker"));
        }
        total
    });
    println!(
        "{} hands of {}, log-loss in nats per hidden card (accuracy)",
        args.hands, args.rules
    );
    println!(
        "{:14}{:>8}{}",
        "phase",
        "cards",
        PREDICTORS.map(|p| format!("{p:>18}")).concat()
    );
    let mut all = (0usize, [0.0; N], [0usize; N]);
    for (p, name) in PHASES.iter().enumerate() {
        let n = total.cards[p];
        if n == 0 {
            continue;
        }
        all.0 += n;
        let cells: String = (0..N)
            .map(|k| {
                all.1[k] += total.loss[p][k];
                all.2[k] += total.hits[p][k];
                format!(
                    "{:>11.4} ({:.2})",
                    total.loss[p][k] / n as f64,
                    total.hits[p][k] as f64 / n as f64
                )
            })
            .collect();
        println!("{name:14}{n:>8}{cells}");
    }
    let cells: String = (0..N)
        .map(|k| {
            format!(
                "{:>11.4} ({:.2})",
                all.1[k] / all.0 as f64,
                all.2[k] as f64 / all.0 as f64
            )
        })
        .collect();
    println!("{:14}{:>8}{cells}", "all", all.0);
}
