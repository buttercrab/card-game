# Experiment loop

The runner that keeps improving bots unattended (P5): experiments are
specs in a queue, run on the Mac (one GPU job at a time) and the home
server (CPU, low priority beside the live bot worker), scored by the same
protocol, recorded in [`../experiments`](../experiments) and summed up on
a leaderboard and in daily reports. When the queue runs low, a research
agent (Claude Code, headless) proposes the next batch within the
[agenda](agenda.md). Code: [`ml/src/cardgame_ml/loop`](../../ml/src/cardgame_ml/loop).

| File | What it is | Who writes it |
| --- | --- | --- |
| [`policy.toml`](policy.toml) | Hosts and caps, limits, the scoring protocol, reference bots | people |
| [`agenda.md`](agenda.md) | What is learnt, what to try (runnable, needs code), what is pruned | researcher, people |
| [`researcher.md`](researcher.md) | The researcher's instructions | people |
| [`requests.md`](requests.md) | Methods the researcher wants that need code | researcher |
| `queue/` | Specs waiting to run | researcher, people, the runner (confirmations) |
| `configs/` | Base training configs specs start from | people (researcher: new files only) |
| `suites/` | The loop's own suites: fresh-deal twins of the scoreboard, head-to-heads | people (`fresh-suite`) |
| `rejected/` | Specs refused, each with a `.reason.txt` | the runner |
| `leaderboard.md`, `.json`, `plots/` | Every run on one table; curves and scaling data | the runner (`report`) |
| `researcher-log.jsonl` | Every researcher call: outcome, specs taken and refused, cost | the runner |
| [`ops/`](ops) | The launchd agent and its install scripts | people |
| [`../reports/`](../reports) | Daily reports, `YYYY-MM-DD.md` | the runner |

## A spec

One TOML file in `queue/`. Example (a DMC learning-rate run):

```toml
id = "dmc-lr1e4"                     # lowercase, digits, dashes; unique
hypothesis = """A learning rate of 1e-4 ... ends higher on the ladder."""
method = "dmc"                       # a runner in cardgame_ml.loop.methods
tags = ["hparam"]                    # method, hybrid, ablation, hparam, scaling, search, eval, baseline
parent = "dmc-v1-score"              # a loop run's id, or "bot:<spec>"; compared with
priority = 50                        # higher first
seeds = [20261005]                   # several: one run each (<id>-s<seed>)
after = []                           # loop runs that must finish first
requires = []                        # artifact-store paths that must exist

[budget]
wall_hours = 20.0                    # the whole run; past it, stopped
train_hours = 5.25                   # training kinds: the trainer's own stop
hands = 20000000
gpu = true

[resources]
host = "mac"                         # the main step
threads = 12
eval_host = "home"                   # the suite runs
eval_threads = 6

[evals]
curve = true                         # the protocol's learning curve
suite = "v1"
parts = ["ladder", "presets", "heldout", "puzzles"]
baselines = ["hard"]                 # one suite run each; "parent" = the parent's bot
cost = true                          # think time on the home server

[config]                             # training kinds: a base and overrides
base = "research/loop/configs/dmc-v1.toml"

[config.set]                         # dotted keys the base has, same types
"optim.lr" = 0.0001

[options]                            # the method's own (eval-only: bot = "...")
```

`python -m cardgame_ml.loop validate <files>` checks specs as the runner
will (`--researcher` with the researcher's limits). Checked: every key
known and typed; the method exists (and, for the researcher, the policy
allows it); hosts, threads (a host's `cores` at most), wall hours (the
policy's `max_wall_hours`); the protocol (below); no string names
`research/evals` or the held-out sets, in the spec or its base config;
overrides only change keys the base has, never `exclude` or what the loop
sets (`name`, `seed`, `budget`, `curve`); the trainer's own config check
when its code is importable.

### Methods

| Method | Steps | Options |
| --- | --- | --- |
| `dmc` | train (GPU) → curve → export → suite as `dmc:<model>` | `temperature` |
| `belief` | train (GPU) → score (gate A) → export → suite as `belief:<model>:<samples>` | `samples` (200) |
| `eval-only` | the suite, for any bot (`{artifacts}` names the artifact store) | `bot`, `clock`, `deal_threads` |
| `search-tuning` | the suite for a search with other settings, tagged `search` | as `eval-only` |

Bots that think on a clock (`search:N:C:<ms>`) are refused unless
`clock = true`: they measure the machine but do not reproduce.
`deal_threads` plays fewer deals at once than the threads held, for a
search that uses the threads itself (`@threads=12`).

**Adding a method** (a person, never the researcher): a class in
`ml/src/cardgame_ml/loop/methods/` with `name`, `trains`, `check(spec,
policy, repo)` (problems as strings) and `plan(ctx)` returning a `Plan`
(steps, the bot it is scored as, the model, the effective config); end
with `eval_steps(ctx, bot)` so scoring stays the protocol's. Register it
in `methods/__init__.py`, test `check` and `plan` like
`ml/tests/test_loop_spec.py`, then add it to the policy's
`limits.methods` and move its agenda items to *Now*.

## The runner

`python -m cardgame_ml.loop run` ticks every 30 seconds:

1. **Watch** each active run's step: ended well → the next step; failed
   → the run fails, with the log's last lines; lost (no process, no exit
   code: a restart or a kill) → started again, up to `max_attempts`
   (training resumes from its checkpoint), then `interrupted`. Past its
   wall budget, or cancelled, a step gets SIGTERM, then SIGKILL after its
   grace (two minutes for training, which checkpoints on SIGTERM).
2. **Start** what fits: next steps of active runs first, then the queue
   (priority, then file name), each spec once its `after` runs and
   parent finished well and its `requires` exist. **One GPU job at a
   time**, and none while a training process the loop did not start is
   running (interactive work keeps the GPU). Each host's loop steps hold
   at most its `threads`; a bigger step (up to `cores`) starts only on an
   idle host; a GPU step waiting for threads keeps new work off its host
   so it is not starved. Nothing new starts on a remote host while it is
   unreachable or above `max_load`.
3. **Record**: a new run gets `research/experiments/<date>-<id>/` with
   `spec.toml` and `config.toml` (effective); while active its record is
   in `<store>/loop/runs/`, so the checkout stays clean for steps that
   refuse uncommitted changes; when it ends, `run.json` (commit,
   environment, every step's host, times, exit code and log path),
   `results/<step>/` and `summary.md` land in the folder, and the
   leaderboard is rewritten. On the policy's `loop_branch`, the runner
   commits `research/` records (never pushes); on any other branch it
   refuses to run unless `--no-commit`.

Only one runner works at a time (a lock in `<store>/loop/runner.lock`).
Steps run in their own process groups and write their exit code to a
file, so a restarted runner adopts running steps and reads finished
ones. `pause` stops new starts, `resume` undoes it, `cancel <id>` stops a
run.

### The home server

Only `eval` steps go there (nothing but cargo is needed). For a run's
exact commit, `git archive` is unpacked into `~/research/card-game/code/
<commit>` and built there (`cargo build --release --locked`, at the
step's threads); models a step plays by are copied to
`~/research/card-game/artifacts/`; each step runs under `nohup setsid
nice -n 15` in `~/research/card-game/runs/<run>/<step>/`, and its
output and log are fetched back when it ends. Every remote command is
`ssh home bash -s` (the login shell is fish). The loop touches nothing
outside `~/research/card-game` (never Docker, systemd or the bot worker),
keeps at most 6 threads there (12 for a step that has the server to
itself), starts nothing while the load average is above 6, and keeps
only the newest three code folders.

## Scoring

The protocol is the policy's, not the spec's:

- **Learning curve** (training runs): DMC v1's — greedy, one seat of
  경기과고 against four 초보 and four 보통 on the same 2 000 deals every
  50 000 hands; a config's `[curve]` is replaced by it.
- **Final evals**: suite v1 through `eval` (the loop never reads the
  held-out rule sets: `eval` does, from the suite), always with `hard`
  (고수) as a deal-by-deal baseline for training runs, which play at
  least ladder, presets and held-out; think time on the home server.
- **Against the parent**: on the ladder rating (else presets, else a
  head-to-head's pooled tables), deal by deal when the parent's bot was
  the baseline, else the difference of the two runs' ratings.
- **Confirmation**: a run that beats its parent beyond the 95% interval
  is a *candidate*; the runner queues `<id>-confirm`: the same spec on
  training seed + 1000, played deal by deal against the parent's bot on
  `suites/v1-fresh-1` (suite v1's ladder, presets and held-out sets with
  every seed moved by 10 million, the held-out file named by path and
  hash; `fresh-suite K` writes others). The candidate is **confirmed**
  only if that run beats the parent too. Runs on the loop's other suites
  (head-to-heads) are not confirmed by the runner.

## The researcher

Called when fewer than `low_water` runnable specs wait, at most every
`min_interval_hours` and `max_calls_per_day` times a day, never while
`<store>/loop/researcher-off` exists. It runs in the background:

```
claude -p <researcher.md + briefing> --model claude-opus-5-5 --output-format json
  --permission-mode dontAsk --no-session-persistence --strict-mcp-config
  --tools Read,Glob,Grep,Write,Edit,Bash
  --allowedTools Read Glob Grep 'Write(research/loop/**)' 'Edit(research/loop/**)'
      'Write(research/experiments/*/notes.md)' 'Edit(research/experiments/*/notes.md)'
      'Bash(uv run --project ml python -m cardgame_ml.loop validate:*)'
  --disallowedTools 'Read(research/evals/**)' 'Edit(research/evals/**)' 'Write(research/evals/**)'
```

The briefing names the time, the queue, the recent runs and the limits.
Afterwards the runner checks the work whatever the tool rules allowed:
any change outside the queue, `configs/`, the agenda, the requests and
runs' `notes.md` is reverted and switches the researcher off (with the
reason in `researcher-off`); every new or changed spec is validated with
the researcher's limits (at most `max_specs_per_call`, the queue under
`max_gpu_hours_queued`), and failures go to `rejected/`; confirmations
it touched are put back. Calls past `timeout_minutes` are killed. Each
call is a line in `researcher-log.jsonl` (outcome, specs taken and
refused, paths changed, cost and turns, its closing summary); the
transcript stays in `<store>/loop/researcher/`. `research --dry-run`
prints the briefing and command without calling.

## Reports

- `python -m cardgame_ml.loop report` rewrites `leaderboard.md`/`.json`
  and `plots/`: per run the method, what it varied, hands, parameters,
  GPU hours and thread-hours, rating (suite v1's ladder, ± 95%), against
  고수 (ladder, presets, held-out; deal by deal), think time (median/p99
  ms), against its parent (✓ when it beats it), status, confirmed; the
  policy's reference bots (고수) on top of their rating. `plots/` holds
  `curves.csv` and `curve-<opponent>.svg` (learning curves),
  `scaling.csv`, `scaling-hands.svg` and `scaling-gpu.svg` (rating
  against hands and GPU hours, for fitting).
- The runner writes yesterday's daily report after `report_hour`:
  runs started and ended, results, the best so far, notable events
  (candidates, confirmations, new notes), failures with their causes,
  researcher calls, what runs and what is queued next, and compute used
  that day (GPU hours, thread-hours on the Mac and the home server).
  `report --daily <date>` writes any day's again.
- `status` says what runs now: the runner's lock holder, active runs and
  their budgets, the queue and why each spec waits, the GPU's holder
  (ours or not), threads in use against each cap and each host's load,
  the researcher's last call and when it is next due, the next report.

## Operating it

The runner lives in its own checkout, a worktree on branch `loop`
(default `~/card-game-loop`), so it never fights interactive work:

```sh
research/loop/ops/install.sh       # worktree, uv sync --extra torch, build eval, load the agent
research/loop/ops/uninstall.sh     # unload it (steps already running go on)
cd ~/card-game-loop/ml && uv run python -m cardgame_ml.loop status
tail -f ~/card-game-artifacts/loop/logs/runner.log
```

The agent (`ops/io.buttercrab.cards.loop.plist`) keeps the Mac awake
while the runner runs (`caffeinate -is`) and starts it again if it stops.
To give the loop new code: merge it into `loop` in that worktree, then
`launchctl kickstart -k gui/$(id -u)/io.buttercrab.cards.loop`; running
steps are adopted. To bring results back: merge `loop` into the working
branch (it only adds and changes `research/` files).
