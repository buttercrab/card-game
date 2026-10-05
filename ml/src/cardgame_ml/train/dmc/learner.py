"""The learner: regresses Q onto Monte Carlo returns while the actors play.

The learner owns the network on the accelerator. Actor processes
(``actor``) play self-play hands with CPU copies of it and send finished
decisions, each labelled with its seat's payoff for the hand; the learner
keeps the latest in a replay buffer and takes AdamW steps on the mean
squared error between ``Q(observation, action taken)`` and that return.
Every ``refresh_every`` steps it publishes its weights to shared memory,
from which the actors reload. No search, no bootstrapping: the target is
the hand's real outcome.

A run writes into its directory: ``config.json`` (the config, the spec,
the parameter count), ``log.jsonl`` (throughput, losses by phase of the
hand, the learning curve), ``checkpoint.pt`` (to resume from, every
``checkpoint_minutes``), ``snapshots/hands-<n>.pt`` (the weights at each
point of the learning curve) and at the end ``model.pt`` and
``metrics.json``. Stopped and started again, it resumes from the
checkpoint (weights, optimiser, counts; the buffer refills) with fresh
actor seeds.
"""

# PyTorch leaves a few parameters unannotated (manual_seed's seed,
# Tensor.backward's, Optimizer.step's closure), which strict mode reports.
# pyright: reportUnknownMemberType=false

import dataclasses
import json
import queue
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, cast

import numpy as np
import torch
from cardgame_env import Env

from cardgame_ml.data.spec import EncodingSpec
from cardgame_ml.models.config import QConfig
from cardgame_ml.models.q import QModel
from cardgame_ml.train.belief import device_for
from cardgame_ml.train.config import from_mapping
from cardgame_ml.train.dmc import actor, curve
from cardgame_ml.train.dmc.buffer import Batch, ReplayBuffer
from cardgame_ml.train.dmc.config import DmcConfig, curve_deals
from cardgame_ml.train.dmc.system import gpu_utilisation, load_average
from cardgame_ml.train.metrics import PHASES, phases

type Log = Callable[[dict[str, Any]], None]


@dataclass
class Progress:
    """What a run has done so far; saved with every checkpoint."""

    step: int = 0
    hands: int = 0
    decisions: int = 0
    trained: int = 0
    """Decisions trained on, counted with repeats."""
    seconds: float = 0.0
    """Wall time of the run, over every session."""
    next_curve: int = 0
    """Hands at which the next point of the learning curve is due."""
    sessions: int = 0


class PhaseLoss:
    """Squared errors and targets summed by phase of the hand, on the
    device (reading them back each step would stall it)."""

    NAMES = (*PHASES, "other")

    def __init__(self, device: torch.device) -> None:
        self.device = device
        self.sums = torch.zeros(len(self.NAMES), 4, device=device)

    def add(self, phase: np.ndarray[Any, Any], error: torch.Tensor, target: torch.Tensor) -> None:
        index = torch.as_tensor(np.where(phase < 0, len(PHASES), phase), device=self.device)
        rows = torch.stack(
            (torch.ones_like(target), error.square(), target, target.square()), dim=1
        )
        self.sums.index_add_(0, index, rows)

    def report(self) -> dict[str, dict[str, float]]:
        """By phase: decisions, MSE, and the share of the targets' variance
        explained (1 - MSE / variance): how well each phase is learnt."""
        out: dict[str, dict[str, float]] = {}
        sums = cast(list[list[float]], self.sums.cpu().tolist())
        for name, (n, se, t, t2) in zip(self.NAMES, sums, strict=True):
            if n == 0:
                continue
            variance = t2 / n - (t / n) ** 2
            mse = se / n
            explained = 1 - mse / variance if variance > 0 else float("nan")
            out[name] = {"decisions": int(n), "mse": mse, "explained": explained}
        self.sums.zero_()
        return out


def _step(
    model: QModel,
    optimizer: torch.optim.Optimizer,
    batch: Batch,
    grad_clip: float,
    losses: PhaseLoss,
) -> torch.Tensor:
    """One AdamW step on the squared error of ``Q(observation, action
    taken)`` against the return; the batch's errors go to ``losses``."""
    device = losses.device
    inputs = (
        torch.as_tensor(batch["global"], device=device),
        torch.as_tensor(batch["cards"], device=device).float(),
        torch.as_tensor(batch["events"], device=device).float(),
        torch.as_tensor(batch["event_cards"].astype(np.int64), device=device),
        torch.as_tensor(batch["events_len"].astype(np.int64), device=device),
        torch.as_tensor(batch["action"], device=device).unsqueeze(1),
    )
    target = torch.as_tensor(batch["target"], device=device)
    q = model(*inputs)[:, 0]
    error = q - target
    loss = error.square().mean()
    optimizer.zero_grad(set_to_none=True)
    loss.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), grad_clip)
    optimizer.step()
    losses.add(phases(model.spec, np.asarray(batch["global"], np.float32)), error.detach(), target)
    return loss.detach()


def _actor_seed(config: DmcConfig, session: int, index: int) -> int:
    """Distinct for every actor of every session of a run."""
    sequence = np.random.SeedSequence(config.seed, spawn_key=(session, index))
    return int(sequence.generate_state(1, np.uint64)[0] >> np.uint64(1))


def _learning_rate(config: DmcConfig, step: int) -> float:
    o = config.optim
    return o.lr * min(1.0, (step + 1) / max(o.warmup_steps, 1))


def describe(config: DmcConfig, spec: EncodingSpec, model: QModel) -> dict[str, Any]:
    return {
        "config": asdict(config),
        "encoding": spec.version,
        "spec": spec.to_json(),
        "parameters": model.parameter_count(),
        "reward_scale": config.reward_scale,
    }


class EncodingMismatchError(ValueError):
    """A run or model reads another encoding than this build's."""


def current_spec() -> EncodingSpec:
    """The encoding this build's environment writes."""
    return EncodingSpec.from_json(Env(num_envs=1, seed=0, threads=1).spec())


def check_encoding(where: Path, described: dict[str, Any], ours: EncodingSpec) -> None:
    """Refuses a run or model directory (its ``config.json`` read into
    ``described``) whose network reads another encoding than ``ours``: its
    weights would not fit, or would silently mean something else."""
    theirs = EncodingSpec.from_json(described["spec"])
    if theirs != ours:
        raise EncodingMismatchError(
            f"{where}: the network reads {theirs.version}, not {ours.version}"
        )


def load(run: Path, weights: Path | None = None, device: torch.device | None = None) -> QModel:
    """The network of run directory ``run`` (or of a model directory with
    its ``config.json``): ``model.pt``, or another weights file (a
    snapshot), in eval mode. Refuses one of another encoding
    (``EncodingMismatchError``)."""
    described = json.loads((run / "config.json").read_text(encoding="utf-8"))
    check_encoding(run, described, current_spec())
    spec = EncodingSpec.from_json(described["spec"])
    where = str(run / "config.json")
    model = QModel(spec, from_mapping(QConfig, described["config"]["model"], where))
    device = device or torch.device("cpu")
    path = weights or run / "model.pt"
    model.load_state_dict(torch.load(path, map_location=device, weights_only=True))
    return model.to(device).eval()


class Learner:
    """One session of a run: start the actors, learn until the budget is
    spent or the process is stopped, checkpoint on the way out."""

    def __init__(self, config: DmcConfig, out: Path, exclude: Path, log: Log) -> None:
        self.config, self.out, self.exclude, self.log = config, out, exclude, log
        self.device = device_for(config.device)
        torch.manual_seed(config.seed)
        probe = Env(num_envs=1, seed=0, rules=config.rules, exclude=exclude, threads=1)
        self.spec = EncodingSpec.from_json(probe.spec())
        self.model = QModel(self.spec, config.model).to(self.device)
        self.optimizer = torch.optim.AdamW(
            self.model.parameters(),
            lr=config.optim.lr,
            betas=(0.9, 0.99),
            weight_decay=config.optim.weight_decay,
        )
        self.progress = Progress()
        out.mkdir(parents=True, exist_ok=True)
        (out / "snapshots").mkdir(exist_ok=True)
        checkpoint = out / "checkpoint.pt"
        if checkpoint.exists():
            described = json.loads((out / "config.json").read_text(encoding="utf-8"))
            check_encoding(out, described, self.spec)
            state = torch.load(checkpoint, map_location=self.device, weights_only=False)
            self.model.load_state_dict(state["model"])
            self.optimizer.load_state_dict(state["optimizer"])
            self.progress = Progress(**state["progress"])
            log({"event": "resume", **asdict(self.progress)})
        self.progress.sessions += 1
        _write_json(out / "config.json", describe(config, self.spec, self.model))
        self.buffer = ReplayBuffer(self.spec, config.buffer.capacity)
        self.rng = np.random.default_rng([config.seed, self.progress.sessions])
        self.losses = PhaseLoss(self.device)

    def run(self) -> Progress:
        config, progress = self.config, self.progress
        a = config.actors
        context = torch.multiprocessing.get_context("spawn")
        shared = QModel(self.spec, config.model)
        shared.share_memory()
        shared_state = shared.state_dict()
        version = context.Value("q", 0)
        lock = context.Lock()
        reports: Any = context.Queue(maxsize=4 * a.processes)
        stop = context.Event()
        self._publish(shared_state, version, lock)
        processes = [
            context.Process(
                target=actor.run,
                args=(
                    i,
                    config,
                    self.spec.to_json(),
                    str(self.exclude),
                    shared_state,
                    version,
                    lock,
                    reports,
                    stop,
                    _actor_seed(config, progress.sessions, i),
                ),
                daemon=True,
            )
            for i in range(a.processes)
        ]
        for p in processes:
            p.start()
        self.log(
            {
                "event": "start",
                "device": str(self.device),
                "actors": a.processes,
                "parameters": self.model.parameter_count(),
                "session": progress.sessions,
            }
        )
        try:
            self._loop(reports, shared_state, version, lock)
        finally:
            stop.set()
            _drain(reports)
            for p in processes:
                p.join(timeout=10)
                if p.is_alive():
                    p.terminate()
            self._checkpoint()
        return progress

    def _loop(self, reports: Any, shared: dict[str, torch.Tensor], version: Any, lock: Any) -> None:
        config, progress, buffer = self.config, self.progress, self.buffer
        budget = config.budget
        session_start = time.monotonic()
        base_seconds = progress.seconds
        last_checkpoint = time.monotonic()
        window = _Window()
        added_session = trained_session = 0
        ready: list[Batch] = []
        while True:
            progress.seconds = base_seconds + time.monotonic() - session_start
            if progress.hands >= budget.hands or progress.seconds >= budget.hours * 3600:
                break
            if progress.hands >= progress.next_curve:
                self._curve()
                progress.next_curve += config.curve.every_hands
            starved = (
                buffer.size < config.buffer.min_fill
                or trained_session >= config.buffer.replay_ratio * max(added_session, 1)
            )
            for report in _take(reports, block=starved):
                buffer.add(report.decisions)
                added_session += len(report.decisions)
                progress.hands += report.hands
                progress.decisions += len(report.decisions)
                window.add(report, version.value)
            if buffer.size >= config.buffer.min_fill and trained_session < (
                config.buffer.replay_ratio * added_session
            ):
                started = time.monotonic()
                for group in self.optimizer.param_groups:
                    group["lr"] = _learning_rate(config, progress.step)
                if not ready:
                    ready = buffer.sample(config.optim.batch_size, self.rng, config.buffer.window)
                batch = ready.pop()
                window.loss += _step(
                    self.model,
                    self.optimizer,
                    batch,
                    config.optim.grad_clip,
                    self.losses,
                )
                progress.step += 1
                progress.trained += len(batch["target"])
                trained_session += len(batch["target"])
                window.steps += 1
                window.learner_seconds += time.monotonic() - started
                if progress.step % config.actors.refresh_every == 0:
                    self._publish(shared, version, lock)
            if time.monotonic() - window.started >= config.log_seconds:
                self._log_window(window)
                window = _Window()
            if time.monotonic() - last_checkpoint >= 60 * config.checkpoint_minutes:
                self._checkpoint()
                last_checkpoint = time.monotonic()
        self._curve()
        torch.save(self.model.state_dict(), self.out / "model.pt")
        self.log({"event": "end", **asdict(progress)})

    def _publish(self, shared: dict[str, torch.Tensor], version: Any, lock: Any) -> None:
        with lock, torch.no_grad():
            for name, value in self.model.state_dict().items():
                shared[name].copy_(value.detach().cpu())
            version.value += 1

    def _curve(self) -> None:
        """A point of the learning curve, and a snapshot of the weights it
        measured."""
        c, progress = self.config.curve, self.progress
        started = time.monotonic()
        self.model.eval()
        scores = {
            opponent: curve.play(
                self.model,
                self.device,
                rules=c.rules,
                opponent=opponent,
                deals=deals,
                seed=c.seed,
                threads=c.threads,
            ).to_json()
            for opponent, deals in (curve_deals(o, c.deals) for o in c.opponents)
        }
        self.model.train()
        snapshot = self.out / "snapshots" / f"hands-{progress.hands:010d}.pt"
        torch.save(self.model.state_dict(), snapshot)
        self.log(
            {
                "event": "curve",
                "hands": progress.hands,
                "decisions": progress.decisions,
                "step": progress.step,
                "seconds": round(progress.seconds),
                "rules": c.rules,
                "scores": scores,
                "snapshot": snapshot.name,
                "eval_seconds": round(time.monotonic() - started, 1),
            }
        )

    def _checkpoint(self) -> None:
        state = {
            "model": self.model.state_dict(),
            "optimizer": self.optimizer.state_dict(),
            "progress": asdict(self.progress),
        }
        path = self.out / "checkpoint.pt"
        torch.save(state, path.with_suffix(".tmp"))
        path.with_suffix(".tmp").replace(path)

    def _log_window(self, window: "_Window") -> None:
        seconds = time.monotonic() - window.started
        progress = self.progress
        self.log(
            {
                "event": "train",
                "step": progress.step,
                "hands": progress.hands,
                "decisions": progress.decisions,
                "seconds": round(progress.seconds),
                "lr": self.optimizer.param_groups[0]["lr"],
                "loss": float(window.loss) / max(window.steps, 1),
                "phases": self.losses.report(),
                "throughput": {
                    "hands_per_s": window.hands / seconds,
                    "decisions_per_s": window.decisions / seconds,
                    "learner_steps_per_s": window.steps / seconds,
                    "samples_per_s": window.steps * self.config.optim.batch_size / seconds,
                    "replay_ratio": progress.trained / max(progress.decisions, 1),
                    "window_replay_ratio": window.steps
                    * self.config.optim.batch_size
                    / max(window.decisions, 1),
                    "exploring_starts_per_hand": window.starts / max(window.hands, 1),
                    "learner_busy": window.learner_seconds / seconds,
                    "actor_cpu_cores": window.cpu_seconds / seconds,
                    "actor_model_share": window.model_seconds
                    / max(window.model_seconds + window.env_seconds, 1e-9),
                    "weights_lag": window.lag / max(window.reports, 1),
                    "gpu_utilisation": gpu_utilisation(),
                    "load_average": load_average(),
                    "buffer": self.buffer.size,
                },
            }
        )


@dataclass
class _Window:
    """Counts since the last throughput line."""

    started: float = dataclasses.field(default_factory=time.monotonic)
    hands: int = 0
    decisions: int = 0
    steps: int = 0
    loss: torch.Tensor | float = 0.0
    learner_seconds: float = 0.0
    cpu_seconds: float = 0.0
    model_seconds: float = 0.0
    env_seconds: float = 0.0
    lag: int = 0
    reports: int = 0
    starts: int = 0

    def add(self, report: actor.Report, version: int) -> None:
        self.hands += report.hands
        self.decisions += len(report.decisions)
        self.cpu_seconds += report.cpu_seconds
        self.model_seconds += report.model_seconds
        self.env_seconds += report.env_seconds
        self.lag += version - report.version
        self.starts += report.starts
        self.reports += 1


def _take(reports: Any, block: bool) -> list[actor.Report]:
    """Every report waiting; with ``block``, at least one (or none after
    a second, so the loop stays responsive)."""
    taken: list[actor.Report] = []
    if block:
        try:
            taken.append(reports.get(timeout=1.0))
        except queue.Empty:
            return taken
    while True:
        try:
            taken.append(reports.get_nowait())
        except queue.Empty:
            return taken


def _drain(reports: Any) -> None:
    """Empties the queue, so actors blocked on it can see they must stop."""
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        try:
            reports.get(timeout=0.2)
        except queue.Empty:
            return


def _write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def train(config: DmcConfig, out: Path, exclude: Path, log: Log) -> Progress:
    """Runs (or resumes) the run ``config`` into ``out``; see the module docs."""
    return Learner(config, out, exclude, log).run()


__all__ = ["Learner", "PhaseLoss", "Progress", "describe", "load", "train"]
