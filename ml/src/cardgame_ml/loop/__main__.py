"""The experiment loop's command line (run from anywhere in the checkout):

    python -m cardgame_ml.loop run              # the runner, until stopped
    python -m cardgame_ml.loop status           # what it is doing
    python -m cardgame_ml.loop report           # the leaderboard and plots
    python -m cardgame_ml.loop report --daily 2026-10-06
    python -m cardgame_ml.loop validate research/loop/queue/*.toml
    python -m cardgame_ml.loop research --dry-run
    python -m cardgame_ml.loop pause | resume | cancel <run id>
    python -m cardgame_ml.loop fresh-suite 1

``research/loop/README.md`` has the rest.
"""

import argparse
import json
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

from cardgame_ml.loop import evals
from cardgame_ml.loop.daily import due, write_daily
from cardgame_ml.loop.executors import Places, executors
from cardgame_ml.loop.gitops import Git
from cardgame_ml.loop.layout import Layout
from cardgame_ml.loop.leaderboard import write_leaderboard
from cardgame_ml.loop.policy import Policy
from cardgame_ml.loop.queue import read_queue
from cardgame_ml.loop.records import Records, now_utc
from cardgame_ml.loop.researcher import Researcher, command
from cardgame_ml.loop.safety import name as safe_name
from cardgame_ml.loop.scheduler import Hook, Runner, other_training
from cardgame_ml.loop.status import status
from cardgame_ml.loop.validate import Known, check_file


def find_repo(start: Path) -> Path:
    for folder in (start, *start.parents):
        if (folder / "research" / "loop" / "policy.toml").is_file():
            return folder
    raise SystemExit("not inside the repository (no research/loop/policy.toml above here)")


def main() -> None:  # noqa: PLR0912, PLR0915
    parser = argparse.ArgumentParser(
        prog="python -m cardgame_ml.loop",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="the runner: watch, start and record, every interval")
    run.add_argument("--once", action="store_true", help="one tick, then exit")
    run.add_argument("--interval", type=float, default=30.0, help="seconds between ticks")
    run.add_argument("--no-commit", action="store_true", help="do not commit records")
    run.add_argument("--no-researcher", action="store_true", help="never call the researcher")
    st = sub.add_parser("status", help="running steps, queue, GPU and CPU use, researcher")
    st.add_argument("--no-remote", action="store_true", help="do not ask remote hosts their load")
    rep = sub.add_parser("report", help="rewrite the leaderboard and plots (and a daily report)")
    rep.add_argument("--daily", help="also the daily report of this date (or 'yesterday')")
    val = sub.add_parser("validate", help="check spec files (exit 1 on any problem)")
    val.add_argument("specs", nargs="+", type=Path)
    val.add_argument("--researcher", action="store_true", help="with the researcher's limits")
    res = sub.add_parser("research", help="call the researcher now (as the runner would)")
    res.add_argument("--dry-run", action="store_true", help="print the prompt and command only")
    sub.add_parser("pause", help="start no new steps (running ones go on)")
    sub.add_parser("resume", help="start steps again")
    can = sub.add_parser("cancel", help="stop a run")
    can.add_argument("run_id")
    fresh = sub.add_parser("fresh-suite", help="write the scoreboard on fresh deals, number K")
    fresh.add_argument("k", type=int)
    args = parser.parse_args()

    repo = find_repo(Path.cwd().resolve())
    layout = Layout.default(repo)
    policy = Policy.load(layout.policy)
    now = now_utc()

    if args.command == "run":
        git = None if args.no_commit else Git(repo)
        if git is not None and git.branch() != policy.loop_branch:
            raise SystemExit(
                f"the runner commits on {policy.loop_branch}; this checkout is on {git.branch()} "
                "(use the loop's own worktree, or --no-commit)"
            )
        hooks: list[Hook] = [_daily_hook]
        if not args.no_researcher:
            hooks.append(Researcher(layout, policy, Git(repo)))
        places = Places(repo, layout.artifacts, layout.experiments)
        runner = Runner(
            layout,
            policy,
            executors(policy.hosts, places),
            git=git,
            hooks=tuple(hooks),
            say=lambda line: print(f"{now_utc():%Y-%m-%d %H:%M:%S} {line}", flush=True),
        )
        runner.serve(args.interval, once=args.once)
    elif args.command == "status":
        places = Places(repo, layout.artifacts, layout.experiments)
        hosts = executors(policy.hosts, places)
        loads = {
            name: (None if args.no_remote and host.host.ssh else host.load())
            for name, host in hosts.items()
        }
        researcher = Researcher(layout, policy, Git(repo))
        print(
            status(
                layout,
                policy,
                now,
                loads=loads,
                other_training=other_training(_own_groups(layout)),
                researcher_not_due=researcher.not_due,
            )
        )
    elif args.command == "report":
        for path in write_leaderboard(layout, policy):
            print(path.relative_to(repo))
        if args.daily:
            day = (
                now.astimezone().date() - timedelta(days=1)
                if args.daily == "yesterday"
                else date.fromisoformat(args.daily)
            )
            print(write_daily(layout, policy, day).relative_to(repo))
    elif args.command == "validate":
        runs = Records(layout.experiments, layout.live).by_id()
        queue = read_queue(layout.queue)
        bad = 0
        for path in args.specs:
            others = [q.spec.id for q in queue if q.spec and q.path.resolve() != path.resolve()]
            spec, problems = check_file(
                path, policy, repo, Known(runs, others), researcher=args.researcher
            )
            if problems:
                bad += 1
                for problem in problems:
                    print(f"{path}: {problem}")
            elif spec is not None:
                print(f"{path}: ok ({spec.id}, {spec.method}, {spec.budget.wall_hours} h)")
        sys.exit(1 if bad else 0)
    elif args.command == "research":
        researcher = Researcher(layout, policy, Git(repo))
        if args.dry_run:
            print(researcher.briefing(now).text(policy))
            print()
            print(json.dumps(command(policy, "<researcher.md + briefing>", repo), indent=1))
            print(f"spent in the last day: ${researcher.spent(now):.2f}")
            print(f"not due because: {researcher.not_due(now) or '(it is due)'}")
        else:
            if researcher.state_file.exists():
                raise SystemExit("a call is under way")
            try:
                researcher.start(now)
            except RuntimeError as e:
                raise SystemExit(str(e)) from None
            print("called; the runner (or `status`) shows when it is done")
    elif args.command == "pause":
        layout.pause.parent.mkdir(parents=True, exist_ok=True)
        layout.pause.write_text(f"paused at {now:%Y-%m-%dT%H:%M:%SZ}\n", encoding="utf-8")
    elif args.command == "resume":
        layout.pause.unlink(missing_ok=True)
    elif args.command == "cancel":
        layout.cancel.mkdir(parents=True, exist_ok=True)
        run_id = safe_name(args.run_id, "run id")
        (layout.cancel / run_id).write_text("cancelled\n", encoding="utf-8")
    elif args.command == "fresh-suite":
        source_dir = repo / "research" / "evals" / policy.protocol.suite
        source = json.loads((source_dir / "suite.json").read_text(encoding="utf-8"))
        name = f"{policy.protocol.suite}-fresh-{args.k}"
        suite = evals.fresh_suite(source, name, args.k, f"../../../evals/{policy.protocol.suite}")
        out = layout.suites / name
        out.mkdir(parents=True, exist_ok=True)
        (out / "suite.json").write_text(
            json.dumps(suite, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        print(out.relative_to(repo))


def _daily_hook(runner: Runner, now: datetime) -> bool:
    day = due(runner.layout, runner.policy, now)
    if day is None:
        return False
    write_leaderboard(runner.layout, runner.policy)
    write_daily(runner.layout, runner.policy, day)
    runner.say(f"daily report for {day} written")
    return True


def _own_groups(layout: Layout) -> set[int]:
    records = Records(layout.experiments, layout.live)
    return {
        s.pid
        for r in records.active()
        for s in r.steps
        if s.status == "running" and s.pid is not None and s.step.host == "mac"
    }


if __name__ == "__main__":
    main()
