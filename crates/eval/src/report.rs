//! `report.md`: the results for people. Everything in it comes from
//! [`Results`], so the JSON is the record and this is a view of it.

use crate::results::{PuzzlesResult, Results, Summary, TableResult};
use crate::stats::{Estimate, ThinkTime};
use std::fmt::Write;

/// Two runs side by side, part by part: each one's bot, and the second
/// minus the first. A field bot both name but with another fingerprint is
/// flagged first: the numbers against it do not compare.
pub fn comparison(a: &Results, b: &Results) -> String {
    let mut out = String::new();
    let w = &mut out;
    let _ = writeln!(
        w,
        "`{}` ({}) against `{}` ({})\n",
        b.bot, b.suite.name, a.bot, a.suite.name
    );
    for name in a.differing_fields(b) {
        let _ = writeln!(
            w,
            "FIELD DIFFERS: `{name}` is not the same bot in both runs (fingerprint {} against {}); numbers against it do not compare",
            a.fingerprints[&name], b.fingerprints[&name]
        );
    }
    let missing: Vec<&String> = (a.fingerprints.keys().chain(b.fingerprints.keys()))
        .filter(|name| !(a.fingerprints.contains_key(*name) && b.fingerprints.contains_key(*name)))
        .collect();
    if a.fingerprints.is_empty() || b.fingerprints.is_empty() {
        let _ = writeln!(w, "A run without fingerprints: its field bots cannot be checked");
    } else if !missing.is_empty() {
        let _ = writeln!(w, "Fields in one run only: {missing:?}");
    }
    let parts = [
        (
            "ladder",
            a.ladder.as_ref().map(|l| l.rating),
            b.ladder.as_ref().map(|l| l.rating),
        ),
        (
            "presets",
            a.presets.as_ref().map(|p| p.average),
            b.presets.as_ref().map(|p| p.average),
        ),
        (
            "heldout",
            a.heldout.as_ref().map(|p| p.average),
            b.heldout.as_ref().map(|p| p.average),
        ),
    ];
    for (part, x, y) in parts {
        if let (Some(x), Some(y)) = (x, y) {
            let diff = Estimate {
                mean: y.bot.mean - x.bot.mean,
                ci95: x.bot.ci95.hypot(y.bot.ci95),
                n: x.bot.n.min(y.bot.n),
            };
            let _ = writeln!(w, "{part}: {} then {}, {diff} (unpaired)", x.bot, y.bot);
        }
    }
    out
}

pub fn markdown(r: &Results) -> String {
    let mut out = String::new();
    let w = &mut out;
    let _ = writeln!(w, "# Eval {}: `{}`\n", r.suite.name, r.bot);
    if r.suite.quick {
        let _ = writeln!(
            w,
            "> **Quick run**: a few deals of everything, to see that it runs. Not a measurement.\n"
        );
    }
    let _ = writeln!(w, "{}\n", header(r));
    let paired = r.baseline.is_some();
    let unit = "Points per seat-hand of the measured seat, ± 95% interval.";
    if let Some(ladder) = &r.ladder {
        let _ = writeln!(w, "## Ladder\n\n{unit}\n");
        tables(w, &ladder.rungs, paired, Some(("Rating", &ladder.rating)));
        let _ = writeln!(
            w,
            "\nRating: the mean over rungs of points per seat-hand, each rung weighted equally.\n"
        );
    }
    if let Some(presets) = &r.presets {
        let _ = writeln!(w, "## Presets\n\n{unit} Field: `{}`.\n", field(&presets.tables));
        tables(w, &presets.tables, paired, Some(("Average", &presets.average)));
        let _ = writeln!(w);
    }
    if let Some(heldout) = &r.heldout {
        let _ = writeln!(
            w,
            "## Held-out rule sets\n\n{unit} Field: `{}`; {} rule sets, {} deals each.\n",
            field(&heldout.tables),
            heldout.tables.len(),
            heldout.tables.first().map_or(0, |t| t.deals)
        );
        tables(w, &[], paired, Some(("Average", &heldout.average)));
        let _ = writeln!(w, "\n<details><summary>Every set</summary>\n");
        tables(w, &heldout.tables, paired, None);
        let _ = writeln!(w, "\n</details>\n");
    }
    if let Some(matches) = &r.matches {
        let _ = writeln!(w, "## Matches\n\n{unit}\n");
        tables(w, matches, paired, None);
        let _ = writeln!(w);
    }
    if let Some(cost) = &r.cost {
        let _ = writeln!(
            w,
            "## Think time\n\nPer decision with a real choice, one deal at a time on one thread: {} deals of `{}` against `{}`.\n",
            cost.deals, cost.rules, cost.field
        );
        let _ = writeln!(
            w,
            "| Bot | Decisions | Median | p90 | p99 | Max |\n|---|---|---|---|---|---|"
        );
        think_row(w, &r.bot, cost.bot);
        if let Some(baseline) = &r.baseline {
            think_row(w, baseline, cost.baseline);
        }
        let _ = writeln!(w);
    }
    if let Some(puzzles) = &r.puzzles {
        puzzle_table(w, puzzles, paired);
    }
    out
}

fn header(r: &Results) -> String {
    let m = &r.machine;
    let mut lines = Vec::new();
    if let Some(baseline) = &r.baseline {
        lines.push(format!("- Baseline: `{baseline}`, in the same seat on the same deals"));
    }
    let commit = r.run.commit.as_deref().map_or("unknown".to_string(), |c| {
        format!(
            "`{}`{}",
            &c[..c.len().min(12)],
            if r.run.dirty { " (with changes)" } else { "" }
        )
    });
    lines.push(format!(
        "- Suite `{}` (SHA-256 `{}…`), commit {commit}",
        r.suite.name,
        &r.suite.sha256[..12]
    ));
    lines.push(format!(
        "- Machine: {}{} ({} {}, {} threads{}); {} worker threads",
        m.label.as_deref().map_or(String::new(), |l| format!("{l}, ")),
        m.cpu.as_deref().unwrap_or("unknown CPU"),
        m.os,
        m.arch,
        m.threads,
        m.load
            .map_or(String::new(), |l| format!(", load {:.1} at the start", l[0])),
        r.run.threads,
    ));
    if !r.fingerprints.is_empty() {
        let fields: Vec<String> = r
            .fingerprints
            .iter()
            .map(|(name, print)| format!("`{name}` {print}"))
            .collect();
        lines.push(format!("- Field fingerprints: {}", fields.join(", ")));
    }
    lines.push(format!(
        "- Started {}, took {}",
        r.run.started,
        duration(r.run.wall_seconds)
    ));
    lines.push(format!(
        "- {}",
        if r.reproducible {
            "Reproducible: no bot decides on a clock, so a rerun of this commit plays every deal the same"
        } else {
            "Not reproducible: a bot thinks on a clock, so a rerun agrees only within the intervals"
        }
    ));
    lines.join("\n")
}

fn duration(seconds: f64) -> String {
    let s = seconds.round() as u64;
    match s {
        0..60 => format!("{s} s"),
        60..3600 => format!("{} min {} s", s / 60, s % 60),
        _ => format!("{} h {} min", s / 3600, s / 60 % 60),
    }
}

fn field(tables: &[TableResult]) -> &str {
    tables.first().map_or("", |t| t.field.as_str())
}

/// One row per table, then the summary row in bold.
fn tables(w: &mut String, rows: &[TableResult], paired: bool, summary: Option<(&str, &Summary)>) {
    let est = |e: Option<Estimate>| e.map_or("".into(), |e| e.to_string());
    if paired {
        let _ = writeln!(
            w,
            "| Table | Rules | Field | Deals | Bot | Baseline | Bot − baseline |\n|---|---|---|---|---|---|---|"
        );
    } else {
        let _ = writeln!(w, "| Table | Rules | Field | Deals | Bot |\n|---|---|---|---|---|");
    }
    for t in rows {
        let _ = write!(
            w,
            "| {} | {} | `{}` | {} | {} |",
            t.name, t.rules, t.field, t.deals, t.bot
        );
        if paired {
            let _ = write!(w, " {} | {} |", est(t.baseline), est(t.diff));
        }
        let _ = writeln!(w);
    }
    if let Some((name, s)) = summary {
        let _ = write!(w, "| **{name}** | | | {} | **{}** |", s.bot.n, s.bot);
        if paired {
            let _ = write!(w, " {} | **{}** |", est(s.baseline), est(s.diff));
        }
        let _ = writeln!(w);
    }
}

fn think_row(w: &mut String, bot: &str, t: Option<ThinkTime>) {
    let _ = match t {
        Some(t) => writeln!(
            w,
            "| `{bot}` | {} | {:.1} ms | {:.0} ms | {:.0} ms | {:.0} ms |",
            t.decisions, t.median_ms, t.p90_ms, t.p99_ms, t.max_ms
        ),
        None => writeln!(w, "| `{bot}` | 0 | | | | |"),
    };
}

fn puzzle_table(w: &mut String, p: &PuzzlesResult, paired: bool) {
    let _ = writeln!(
        w,
        "## Puzzles\n\nPassed {} of {} scored puzzles{}. A puzzle passes when every try picks an acceptable action; informational ones are not scored.\n",
        p.passed,
        p.scored,
        p.baseline_passed.map_or(String::new(), |b| format!(" (baseline {b})"))
    );
    let _ = write!(w, "| Puzzle | Kind | Bot |");
    let _ = writeln!(
        w,
        "{}",
        if paired {
            " Baseline |\n|---|---|---|---|"
        } else {
            "\n|---|---|---|"
        }
    );
    for r in &p.puzzles {
        let mark =
            |a: &crate::puzzle::Answer| format!("{} {}/{}", if a.passed() { "pass" } else { "fail" }, a.right, a.tries);
        let kind = if r.scored { "scored" } else { "informational" };
        let _ = write!(w, "| `{}`: {} | {kind} | {} |", r.id, r.title, mark(&r.bot));
        if let Some(b) = &r.baseline {
            let _ = write!(w, " {} |", mark(b));
        }
        let _ = writeln!(w);
    }
}
