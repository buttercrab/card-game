//! Plays a suite: every part asked for, in order, into [`Results`].

use crate::machine::{self, Machine};
use crate::play::{Deal, Table, play_table};
use crate::puzzle;
use crate::results::{
    CostResult, LadderResult, PartResult, PuzzleResult, PuzzlesResult, Results, RunInfo, SCHEMA, SuiteInfo, Summary,
    TableResult,
};
use crate::stats::{Estimate, ThinkTime};
use crate::suite::{Loaded, Part, deals};
use crate::{EvalGame, preset};
use std::time::Instant;

/// What to run.
pub struct Request<'a> {
    pub suite: &'a Loaded,
    pub bot: &'a str,
    pub baseline: Option<&'a str>,
    pub quick: bool,
    /// The parts to run, of those the suite has.
    pub parts: &'a [Part],
    /// Worker threads; all cores when `None`.
    pub threads: Option<usize>,
    /// Which machine this is, for the record.
    pub machine: Option<String>,
    pub command: Vec<String>,
}

/// Runs `request` for game `G`, telling `progress` about each table as it
/// finishes.
pub fn run<G: EvalGame>(request: &Request, progress: &mut dyn FnMut(&str)) -> Result<Results, String> {
    let Request { suite, quick, .. } = *request;
    let s = &suite.suite;
    if s.game != G::ID {
        return Err(format!("suite {} is for {}, not {}", s.suite, s.game, G::ID));
    }
    let started = Instant::now();
    let machine = Machine::here(request.machine.clone());
    let (commit, dirty) = machine::commit(&suite.dir).map_or((None, false), |(c, d)| (Some(c), d));
    let mut runner = Runner::<G> {
        bot: (request.bot.to_string(), G::parse_bot(request.bot)?),
        baseline: match request.baseline {
            Some(name) => Some((name.to_string(), G::parse_bot(name)?)),
            None => None,
        },
        threads: request.threads,
        reproducible: true,
        progress,
    };
    runner.reproducible =
        G::reproducible(&runner.bot.1) && runner.baseline.as_ref().is_none_or(|b| G::reproducible(&b.1));
    let mut results = Results {
        schema: SCHEMA.into(),
        suite: SuiteInfo {
            name: s.suite.clone(),
            game: s.game.clone(),
            sha256: suite.sha256.clone(),
            quick,
        },
        bot: request.bot.into(),
        baseline: request.baseline.map(Into::into),
        reproducible: false,
        run: RunInfo {
            commit,
            dirty,
            started: machine::now_utc(),
            wall_seconds: 0.0,
            threads: request
                .threads
                .unwrap_or_else(|| std::thread::available_parallelism().map_or(1, |n| n.get())),
            command: request.command.clone(),
        },
        machine,
        ladder: None,
        presets: None,
        heldout: None,
        matches: None,
        cost: None,
        puzzles: None,
    };
    for part in suite.parts().into_iter().filter(|p| request.parts.contains(p)) {
        match part {
            Part::Ladder => results.ladder = Some(runner.ladder(suite, quick)?),
            Part::Presets => results.presets = Some(runner.presets(suite, quick)?),
            Part::Heldout => results.heldout = Some(runner.heldout(suite, quick)?),
            Part::Matches => results.matches = Some(runner.matches(suite, quick)?),
            Part::Cost => results.cost = Some(runner.cost(suite, quick)?),
            Part::Puzzles => results.puzzles = Some(runner.puzzles(suite)?),
        }
    }
    results.reproducible = runner.reproducible;
    results.run.wall_seconds = started.elapsed().as_secs_f64();
    Ok(results)
}

struct Runner<'p, G: EvalGame> {
    bot: (String, G::Spec),
    baseline: Option<(String, G::Spec)>,
    threads: Option<usize>,
    /// Whether every bot played so far decides without a clock.
    reproducible: bool,
    progress: &'p mut dyn FnMut(&str),
}

impl<G: EvalGame> Runner<'_, G> {
    fn field(&mut self, name: &str) -> Result<G::Spec, String> {
        let spec = G::parse_bot(name)?;
        self.reproducible &= G::reproducible(&spec);
        Ok(spec)
    }

    /// Plays one table and sums it up; `label` names its rules.
    fn table(
        &mut self,
        name: &str,
        (label, rules): (String, &G::Rules),
        field: &str,
        seed: u64,
        deals: u64,
    ) -> Result<TableResult, String> {
        if deals == 0 {
            return Err(format!("{name}: no deals to play"));
        }
        let started = Instant::now();
        let spec = self.field(field)?;
        let table = Table::<G> {
            rules,
            field: &spec,
            seed,
            deals,
        };
        let played = play_table(&table, &self.bot.1, self.baseline.as_ref().map(|b| &b.1), self.threads)
            .map_err(|failure| format!("{name}: {failure}"))?;
        let result = summarise(name, label, field, seed, &played, started);
        let mut line = format!("{name}: {} deals, bot {}", result.deals, result.bot);
        if let Some(diff) = result.diff {
            line += &format!(", {diff} over the baseline");
        }
        (self.progress)(&format!("{line} ({:.0} s)", result.seconds));
        Ok(result)
    }

    fn ladder(&mut self, suite: &Loaded, quick: bool) -> Result<LadderResult, String> {
        let started = Instant::now();
        let ladder = suite.suite.ladder.as_ref().expect("the suite has a ladder");
        let rules = preset::<G>(&ladder.rules)?;
        let n = deals(ladder.deals, ladder.quick_deals, quick);
        let rungs = (ladder.rungs.iter().enumerate())
            .map(|(k, rung)| {
                let rules = (ladder.rules.clone(), &rules);
                self.table(&rung.name, rules, &rung.field, ladder.seed + k as u64 * ladder.deals, n)
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(LadderResult {
            rating: Summary::average(&rungs),
            rungs,
            seconds: started.elapsed().as_secs_f64(),
        })
    }

    fn presets(&mut self, suite: &Loaded, quick: bool) -> Result<PartResult, String> {
        let started = Instant::now();
        let p = suite.suite.presets.as_ref().expect("the suite has presets");
        let n = deals(p.deals, p.quick_deals, quick);
        let tables = (p.presets.iter().enumerate())
            .map(|(k, id)| {
                let rules = preset::<G>(id)?;
                self.table(id, (id.clone(), &rules), &p.field, p.seed + k as u64 * p.deals, n)
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(part(tables, started))
    }

    fn heldout(&mut self, suite: &Loaded, quick: bool) -> Result<PartResult, String> {
        let started = Instant::now();
        let h = suite.suite.heldout.as_ref().expect("the suite has held-out rules");
        let sets: Vec<G::Rules> =
            serde_json::from_slice(&suite.read(&h.file, &h.sha256)?).map_err(|e| format!("{}: {e}", h.file))?;
        let count = if quick {
            h.quick_sets.min(sets.len())
        } else {
            sets.len()
        };
        let n = deals(h.deals, h.quick_deals, quick);
        let tables = (sets.iter().enumerate().take(count))
            .map(|(k, rules)| {
                G::validate(rules).map_err(|e| format!("held-out set {k}: {e}"))?;
                let label = G::describe(rules);
                self.table(
                    &format!("set {k}"),
                    (label, rules),
                    &h.field,
                    h.seed + k as u64 * h.deals,
                    n,
                )
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(part(tables, started))
    }

    fn matches(&mut self, suite: &Loaded, quick: bool) -> Result<Vec<TableResult>, String> {
        let matches = suite.suite.matches.as_ref().expect("the suite has matches");
        matches
            .iter()
            .map(|m| {
                let n = deals(m.deals, m.quick_deals, quick);
                let rules = preset::<G>(&m.rules)?;
                self.table(&m.name, (m.rules.clone(), &rules), &m.field, m.seed, n)
            })
            .collect()
    }

    fn cost(&mut self, suite: &Loaded, quick: bool) -> Result<CostResult, String> {
        let started = Instant::now();
        let c = suite.suite.cost.as_ref().expect("the suite has a cost part");
        let rules = preset::<G>(&c.rules)?;
        let field = self.field(&c.field)?;
        let n = deals(c.deals, c.quick_deals, quick);
        let table = Table::<G> {
            rules: &rules,
            field: &field,
            seed: c.seed,
            deals: n,
        };
        // One thread: each deal with the bot, then with the baseline, so
        // both meet the same load.
        let played = play_table(&table, &self.bot.1, self.baseline.as_ref().map(|b| &b.1), Some(1))
            .map_err(|failure| format!("cost: {failure}"))?;
        let bot: Vec<_> = played.iter().flat_map(|d| d.times.iter().copied()).collect();
        let baseline: Vec<_> = (played.iter().filter_map(|d| d.baseline.as_ref()))
            .flat_map(|(_, times)| times.iter().copied())
            .collect();
        let result = CostResult {
            rules: c.rules.clone(),
            field: c.field.clone(),
            seed: c.seed,
            deals: n,
            bot: ThinkTime::of(&bot),
            baseline: ThinkTime::of(&baseline),
            seconds: started.elapsed().as_secs_f64(),
        };
        if let Some(t) = result.bot {
            (self.progress)(&format!(
                "cost: {} decisions, median {:.1} ms, p99 {:.0} ms",
                t.decisions, t.median_ms, t.p99_ms
            ));
        }
        Ok(result)
    }

    fn puzzles(&mut self, suite: &Loaded) -> Result<PuzzlesResult, String> {
        let p = suite.suite.puzzles.as_ref().expect("the suite has puzzles");
        let puzzles = puzzle::parse::<G>(&suite.read(&p.file, &p.sha256)?)?;
        let results = puzzles
            .iter()
            .map(|puzzle| {
                Ok(PuzzleResult {
                    id: puzzle.id.clone(),
                    title: puzzle.title.clone(),
                    scored: puzzle.scored,
                    bot: puzzle.ask(&self.bot.1, p.tries)?,
                    baseline: match &self.baseline {
                        Some((_, b)) => Some(puzzle.ask(b, p.tries)?),
                        None => None,
                    },
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        let scored = results.iter().filter(|r| r.scored);
        let result = PuzzlesResult {
            passed: scored.clone().filter(|r| r.bot.passed()).count(),
            scored: scored.clone().count(),
            baseline_passed: self.baseline.is_some().then(|| {
                scored
                    .filter(|r| r.baseline.as_ref().is_some_and(|a| a.passed()))
                    .count()
            }),
            puzzles: results,
        };
        (self.progress)(&format!("puzzles: {} of {} passed", result.passed, result.scored));
        Ok(result)
    }
}

fn part(tables: Vec<TableResult>, started: Instant) -> PartResult {
    PartResult {
        average: Summary::average(&tables),
        tables,
        seconds: started.elapsed().as_secs_f64(),
    }
}

fn summarise(name: &str, rules: String, field: &str, seed: u64, played: &[Deal], started: Instant) -> TableResult {
    let bot: Vec<f64> = played.iter().map(|d| d.payoff as f64).collect();
    let baseline: Option<Vec<f64>> = played.iter().map(|d| Some(d.baseline.as_ref()?.0 as f64)).collect();
    let diff = baseline
        .as_ref()
        .map(|b| bot.iter().zip(b).map(|(x, y)| x - y).collect::<Vec<_>>());
    let mut digest = String::new();
    for d in played {
        digest += &format!("{} {:?}\n", d.payoff, d.baseline.as_ref().map(|b| b.0));
    }
    TableResult {
        name: name.into(),
        rules,
        field: field.into(),
        seed,
        deals: played.len() as u64,
        bot: Estimate::of(&bot),
        baseline: baseline.as_deref().map(Estimate::of),
        diff: diff.as_deref().map(Estimate::of),
        digest: crate::suite::sha256(digest.as_bytes()),
        seconds: started.elapsed().as_secs_f64(),
    }
}
