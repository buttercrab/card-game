//! Plays a suite: every part asked for, in order, into [`Results`].

use crate::machine::{self, Machine};
use crate::play::{Deal, Table, play_tables};
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
    /// The commit the runner was built from, when it does not run in a
    /// git checkout (such as an exported tree on another machine).
    pub commit: Option<String>,
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
    let (commit, dirty) = match &request.commit {
        Some(commit) => (Some(commit.clone()), false),
        None => machine::commit(&suite.dir).map_or((None, false), |(c, d)| (Some(c), d)),
    };
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

/// A table to play, and how to name it in the results.
struct Planned<G: EvalGame> {
    name: String,
    rules: String,
    field: String,
    table: Table<G>,
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

    /// Plays `tables` together and sums each up.
    fn play(&mut self, tables: Vec<Planned<G>>) -> Result<Vec<TableResult>, String> {
        if let Some(t) = tables.iter().find(|t| t.table.deals == 0) {
            return Err(format!("{}: no deals to play", t.name));
        }
        let (plans, tables): (Vec<_>, Vec<_>) = tables
            .into_iter()
            .map(|t| ((t.name, t.rules, t.field), t.table))
            .unzip();
        let baseline = self.baseline.as_ref().map(|b| &b.1);
        let played = play_tables(&tables, &self.bot.1, baseline, self.threads).map_err(|f| f.to_string())?;
        let results: Vec<TableResult> = (plans.into_iter().zip(&tables).zip(&played))
            .map(|(((name, rules, field), table), deals)| summarise(name, rules, field, table.seed, deals))
            .collect();
        for t in &results {
            let diff = t.diff.map_or(String::new(), |d| format!(", {d} over the baseline"));
            (self.progress)(&format!("{}: {} deals, bot {}{diff}", t.name, t.deals, t.bot));
        }
        Ok(results)
    }

    /// A table to play; `rules` names its rule set for the report.
    fn plan(
        &mut self,
        name: String,
        rules: (String, G::Rules),
        field: &str,
        seed: u64,
        deals: u64,
    ) -> Result<Planned<G>, String> {
        Ok(Planned {
            name,
            rules: rules.0,
            field: field.to_string(),
            table: Table {
                rules: rules.1,
                field: self.field(field)?,
                seed,
                deals,
            },
        })
    }

    fn ladder(&mut self, suite: &Loaded, quick: bool) -> Result<LadderResult, String> {
        let started = Instant::now();
        let ladder = suite.suite.ladder.as_ref().expect("the suite has a ladder");
        let rules = preset::<G>(&ladder.rules)?;
        let n = deals(ladder.deals, ladder.quick_deals, quick);
        let tables = (ladder.rungs.iter().enumerate())
            .map(|(k, rung)| {
                let seed = ladder.seed + k as u64 * ladder.deals;
                self.plan(
                    rung.name.clone(),
                    (ladder.rules.clone(), rules.clone()),
                    &rung.field,
                    seed,
                    n,
                )
            })
            .collect::<Result<Vec<_>, _>>()?;
        let rungs = self.play(tables)?;
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
                self.plan(
                    id.clone(),
                    (id.clone(), preset::<G>(id)?),
                    &p.field,
                    p.seed + k as u64 * p.deals,
                    n,
                )
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(part(self.play(tables)?, started))
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
        let tables = (sets.into_iter().enumerate().take(count))
            .map(|(k, rules)| {
                G::validate(&rules).map_err(|e| format!("held-out set {k}: {e}"))?;
                let label = G::describe(&rules);
                self.plan(
                    format!("set {k}"),
                    (label, rules),
                    &h.field,
                    h.seed + k as u64 * h.deals,
                    n,
                )
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(part(self.play(tables)?, started))
    }

    fn matches(&mut self, suite: &Loaded, quick: bool) -> Result<Vec<TableResult>, String> {
        let matches = suite.suite.matches.as_ref().expect("the suite has matches");
        let tables = (matches.iter())
            .map(|m| {
                let n = deals(m.deals, m.quick_deals, quick);
                self.plan(
                    m.name.clone(),
                    (m.rules.clone(), preset::<G>(&m.rules)?),
                    &m.field,
                    m.seed,
                    n,
                )
            })
            .collect::<Result<Vec<_>, _>>()?;
        self.play(tables)
    }

    fn cost(&mut self, suite: &Loaded, quick: bool) -> Result<CostResult, String> {
        let started = Instant::now();
        let c = suite.suite.cost.as_ref().expect("the suite has a cost part");
        let n = deals(c.deals, c.quick_deals, quick);
        let table = self
            .plan(
                "cost".into(),
                (c.rules.clone(), preset::<G>(&c.rules)?),
                &c.field,
                c.seed,
                n,
            )?
            .table;
        // One thread: each deal with the bot, then with the baseline, so
        // both meet the same load.
        let baseline = self.baseline.as_ref().map(|b| &b.1);
        let played = play_tables(&[table], &self.bot.1, baseline, Some(1)).map_err(|f| format!("cost: {f}"))?;
        let played = &played[0];
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

fn summarise(name: String, rules: String, field: String, seed: u64, played: &[Deal]) -> TableResult {
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
        name,
        rules,
        field,
        seed,
        deals: played.len() as u64,
        bot: Estimate::of(&bot),
        baseline: baseline.as_deref().map(Estimate::of),
        diff: diff.as_deref().map(Estimate::of),
        digest: crate::suite::sha256(digest.as_bytes()),
    }
}
