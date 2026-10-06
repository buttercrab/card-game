"""A finished run's ``summary.md``, written by the runner: the hypothesis,
what was varied, what it cost, what the suite said, against the parent,
and where the logs are."""

from pathlib import Path

from cardgame_ml.loop.evals import EvalResult
from cardgame_ml.loop.methods.base import CURVE_STEP
from cardgame_ml.loop.promotion import eval_results
from cardgame_ml.loop.records import RunRecord
from cardgame_ml.loop.spec import Spec
from cardgame_ml.train.dmc.report import CURVE_FILE, CurveReport


def compute(record: RunRecord) -> dict[str, float]:
    """GPU hours, and thread-hours by host (threads held times hours)."""
    out: dict[str, float] = {"gpu": 0.0}
    for step in record.steps:
        hours = step.hours()
        if step.step.gpu:
            out["gpu"] += hours
        key = f"cpu_{step.step.host}"
        out[key] = out.get(key, 0.0) + hours * step.step.threads
    return out


def varied(params: dict[str, object], equals: str = " = ") -> list[str]:
    """What a run varies (its ``params``), one ``key = value`` each."""
    return [f"{k}{equals}{v}" for k, v in params.items()]


def curve_report(folder: Path) -> CurveReport | None:
    """The learning curve a run's curve step wrote, if it has one."""
    path = folder / "results" / CURVE_STEP / CURVE_FILE
    return CurveReport.load(path) if path.is_file() else None


def eval_row(name: str, r: EvalResult) -> str:
    def cell(summary_attr: str, part: str) -> str:
        summary = r.metric(part)
        value = getattr(summary, summary_attr) if summary else None
        return str(value) if value is not None else "-"

    think = (
        f"{r.think_median_ms:.0f} / {r.think_p99_ms:.0f}"
        if r.think_median_ms is not None and r.think_p99_ms is not None
        else "-"
    )
    puzzles = f"{r.puzzles[0]}/{r.puzzles[1]}" if r.puzzles else "-"
    return (
        f"| {name} | {r.baseline or '-'} | {cell('bot', 'ladder')} | {cell('diff', 'ladder')} "
        f"| {cell('diff', 'presets')} | {cell('diff', 'heldout')} | {think} | {puzzles} |"
    )


def curve_tail(folder: Path, points: int = 5) -> list[str]:
    report = curve_report(folder)
    if report is None or not report.curve:
        return []
    opponents = list(report.curve[0].scores)
    lines = [
        "| hands | hours | " + " | ".join(opponents) + " |",
        "| ---: | ---: | " + " | ".join("---:" for _ in opponents) + " |",
    ]
    for p in report.curve[-points:]:
        scores = " | ".join(f"{p.scores[o].mean:+.2f} ± {p.scores[o].ci95:.2f}" for o in opponents)
        lines.append(f"| {p.hands:,} | {p.seconds / 3600:.2f} | {scores} |")
    return lines


def write_summary(record: RunRecord, spec: Spec, folder: Path) -> Path:
    used = compute(record)
    params = ", ".join(f"`{p}`" for p in varied(record.params)) or "nothing (the base config)"
    lines = [
        f"# {record.id}",
        "",
        f"**Hypothesis.** {spec.hypothesis}",
        "",
        f"- Method: `{record.method}`; tags: {', '.join(record.tags)}",
        f"- Parent: {record.parent or 'none'}; bot: `{record.bot or '-'}`",
        f"- Varied: {params}",
        f"- Commit: `{record.commit}`; seeds: {', '.join(str(s) for s in spec.seeds)}",
        f"- Status: **{record.status}**" + (f" ({record.failure})" if record.failure else ""),
        f"- Compute: {used['gpu']:.2f} GPU h; "
        + ", ".join(f"{k[4:]} {v:.1f} thread-h" for k, v in used.items() if k.startswith("cpu_"))
        + f" (budget {record.wall_hours} h wall)",
    ]
    c = record.comparison
    if c is not None:
        lines.append(
            f"- Against the parent ({c.metric}, {'paired' if c.paired else 'unpaired'}): "
            f"{c.diff}"
            + (" — **beats it**" if c.beats else "")
            + (
                f" — fields differ ({', '.join(c.fields_differ)}): not comparable"
                if c.fields_differ
                else ""
            )
        )
    if record.candidate:
        lines.append(f"- Candidate: confirmation `{record.confirmation}` queued")
    if record.confirmed is not None:
        lines.append(f"- Confirmed on fresh deals: **{'yes' if record.confirmed else 'no'}**")
    results = eval_results(folder)
    if results:
        lines += [
            "",
            "## Suite",
            "",
            "| step | baseline | rating | rating - baseline | presets - baseline "
            "| held-out - baseline | think ms (median / p99) | puzzles |",
            "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
            *(eval_row(name, r) for name, r in results.items()),
        ]
    tail = curve_tail(folder)
    if tail:
        lines += ["", "## Learning curve (last points)", "", *tail]
    lines += [
        "",
        "## Steps",
        "",
        "| step | host | status | hours | log |",
        "| --- | --- | --- | ---: | --- |",
    ]
    for s in record.steps:
        lines.append(
            f"| {s.step.name} | {s.step.host} | {s.status} | {s.hours():.2f} | `{s.log or '-'}` |"
        )
    path = folder / "summary.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path
