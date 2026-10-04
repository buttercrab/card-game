"""Training a belief model on a self-play dataset.

Games, not decisions, are split between training and validation, so no
hand is seen on both sides. Training walks the training games' decisions
once an epoch, in an order drawn from the run's seed; every
``eval_every`` steps and at the end of each epoch the model is scored on
the validation games against the count baseline (``train.metrics``).

A run writes into its directory: ``config.json`` (the config, the spec,
the parameter count), ``log.jsonl`` (one line per logged step and per
evaluation), ``checkpoint.pt`` after each epoch (to resume from) and,
at the end, ``model.pt`` (the weights) and ``metrics.json`` (the last
evaluation). :func:`load` reads a run's model back.
"""

# PyTorch leaves a few parameters unannotated (manual_seed's seed,
# Tensor.backward's, Optimizer.step's closure), which strict mode reports.
# pyright: reportUnknownMemberType=false

import json
import math
import time
from collections.abc import Callable
from dataclasses import asdict
from pathlib import Path
from typing import Any

import numpy as np
import torch

from cardgame_ml.data.shards import Dataset
from cardgame_ml.data.spec import EncodingSpec
from cardgame_ml.models.belief import (
    BeliefModel,
    card_losses,
    class_counts,
    log_probs,
    uniform_log_probs,
)
from cardgame_ml.models.config import BeliefConfig
from cardgame_ml.train.batching import Rows, Split, batches, prefetch, steps_per_epoch, to_inputs
from cardgame_ml.train.config import BeliefTrainConfig
from cardgame_ml.train.metrics import Report, phases

type Log = Callable[[dict[str, Any]], None]

LOG_EVERY = 100
"""Steps between training-loss lines in the log."""


def device_for(name: str) -> torch.device:
    if name == "auto":
        return torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    return torch.device(name)


def evaluate(model: BeliefModel, dataset: Dataset, rows: Rows, batch_size: int = 1024) -> Report:
    """The model and the count baseline on the decisions ``rows`` picks."""
    report = Report()
    device = next(model.parameters()).device
    classes = len(dataset.spec.belief_classes)
    model.eval()
    with torch.no_grad():
        for batch in prefetch(batches(dataset, rows, batch_size, seed=None)):
            targets = torch.as_tensor(batch["belief"], device=device)
            counts = class_counts(targets, classes)
            logits = model(*to_inputs(batch, device))
            ours = card_losses(log_probs(logits, counts), targets)
            base = card_losses(uniform_log_probs(counts, logits.shape[1]), targets)
            report.add(
                phases(dataset.spec, batch["global"]),
                np.nonzero(batch["belief"] >= 0)[0],
                (ours[0].double().cpu().numpy(), ours[1].cpu().numpy()),
                (base[0].double().cpu().numpy(), base[1].cpu().numpy()),
            )
    return report


def learning_rate(config: BeliefTrainConfig, step: int, total: int) -> float:
    o = config.optim
    if step < o.warmup_steps:
        return o.lr * (step + 1) / o.warmup_steps
    progress = min((step - o.warmup_steps) / max(total - o.warmup_steps, 1), 1.0)
    cosine = 0.5 * (1 + math.cos(math.pi * progress))
    return o.lr * (o.min_lr_ratio + (1 - o.min_lr_ratio) * cosine)


def train(config: BeliefTrainConfig, dataset: Dataset, out: Path, log: Log) -> Report:
    """Trains a model by ``config`` into ``out``, resuming from its last
    checkpoint if there is one. Returns the final validation report."""
    out.mkdir(parents=True, exist_ok=True)
    device = device_for(config.device)
    torch.manual_seed(config.seed)
    split = Split.draw(sum(s.games for s in dataset.shards), config.split)
    model = BeliefModel(dataset.spec, config.model).to(device)
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=config.optim.lr,
        betas=(0.9, 0.95),
        weight_decay=config.optim.weight_decay,
    )
    _write_json(out / "config.json", _describe(config, dataset, model))
    total = steps_per_epoch(dataset, split.train_rows, config.optim.batch_size)
    total *= config.optim.epochs

    step, first_epoch = 0, 0
    checkpoint = out / "checkpoint.pt"
    if checkpoint.exists():
        state = torch.load(checkpoint, map_location=device, weights_only=True)
        model.load_state_dict(state["model"])
        optimizer.load_state_dict(state["optimizer"])
        step, first_epoch = int(state["step"]), int(state["epoch"])
        log({"event": "resume", "step": step, "epoch": first_epoch})
    log({"event": "start", "device": str(device), "steps": total})

    def validate(epoch: int) -> Report:
        report = evaluate(model, dataset, split.val_rows)
        log({"event": "val", "step": step, "epoch": epoch, "val": report.to_json()})
        model.train()
        return report

    classes = len(dataset.spec.belief_classes)
    report = Report()
    started = time.monotonic()
    for epoch in range(first_epoch, config.optim.epochs):
        model.train()
        # Summed on the device: reading it back every step would stall.
        running, cards = torch.zeros((), device=device), 0
        seed = config.seed + epoch
        for batch in prefetch(batches(dataset, split.train_rows, config.optim.batch_size, seed)):
            for group in optimizer.param_groups:
                group["lr"] = learning_rate(config, step, total)
            targets = torch.as_tensor(batch["belief"], device=device)
            logits = model(*to_inputs(batch, device))
            losses, _ = card_losses(log_probs(logits, class_counts(targets, classes)), targets)
            optimizer.zero_grad(set_to_none=True)
            losses.mean().backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), config.optim.grad_clip)
            optimizer.step()
            step += 1
            running += losses.detach().sum()
            cards += len(losses)
            if step % LOG_EVERY == 0:
                log(
                    {
                        "event": "train",
                        "step": step,
                        "epoch": epoch,
                        "lr": optimizer.param_groups[0]["lr"],
                        "log_loss": float(running) / max(cards, 1),
                        "seconds": round(time.monotonic() - started),
                    }
                )
                running, cards = torch.zeros((), device=device), 0
            if step % config.eval_every == 0:
                report = validate(epoch)
        report = validate(epoch + 1)
        state = {"model": model.state_dict(), "optimizer": optimizer.state_dict()}
        torch.save({**state, "step": step, "epoch": epoch + 1}, checkpoint)
    torch.save(model.state_dict(), out / "model.pt")
    _write_json(out / "metrics.json", {"step": step, "val": report.to_json()})
    return report


def _describe(config: BeliefTrainConfig, dataset: Dataset, model: BeliefModel) -> dict[str, Any]:
    return {
        "config": asdict(config),
        "dataset": dataset.name,
        "encoding": dataset.encoding,
        "spec": dataset.spec.to_json(),
        "parameters": model.parameter_count(),
    }


def _write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def load(run: Path, device: torch.device | None = None) -> BeliefModel:
    """The trained model in run directory ``run``, in eval mode."""
    described = json.loads((run / "config.json").read_text(encoding="utf-8"))
    spec = EncodingSpec.from_json(described["spec"])
    model = BeliefModel(spec, BeliefConfig(**described["config"]["model"]))
    device = device or torch.device("cpu")
    model.load_state_dict(torch.load(run / "model.pt", map_location=device, weights_only=True))
    return model.to(device).eval()
