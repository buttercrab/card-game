"""Self-play datasets, as the ``selfplay`` generator writes them (``crates/env``).

A dataset is a directory: ``meta.json`` (config, encoding spec, bot
styles, shard list, statistics), ``rules.jsonl.gz`` (every rule set
played, by id) and shards ``shard-00000.npz`` and on, NumPy archives with
one row per decision, whole games in order. Each decision holds the
acting seat's observation (the arrays ``EncodingSpec.shapes`` names), the
action it took, its seat, belief targets, its payoff for the hand, the
bot style that acted, and ids: game, decision, the game's seed and the
first 64 bits of the rules id.

Shards store events ragged (only each decision's ``events_len`` rows)
and in compact types; ``Shard.take`` pads and widens them, so a
``Batch`` has the same observation keys and shapes as an
``cardgame_env.Env`` step, plus the labels.

A shard is the unit of loading: ``Dataset.load`` reads one whole (about
20 KB of arrays a decision), ``Dataset.batches`` walks shards one at a
time in a seeded order.
"""

import gzip
import json
from collections.abc import Collection, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from cardgame_ml._json import as_object, get, get_int, get_list, get_str, get_str_tuple
from cardgame_ml.data.spec import EncodingSpec

ARRAYS = (
    "global",
    "cards",
    "events",
    "event_cards",
    "events_len",
    "legal",
    "action",
    "seat",
    "belief",
    "payoff",
    "style",
    "game",
    "decision",
    "seed",
    "rules",
)
"""Every array of a shard, in the order the generator writes them."""

type Batch = dict[str, NDArray[Any]]
"""Decisions by array name, the batch dimension first; only the arrays
loaded. The observation arrays have an ``Env`` step's shapes and types
(``global``, ``cards`` and ``events`` float32, ``event_cards`` and
``events_len`` int32, ``legal`` bool); ``action``, ``seat``, ``belief``
(-1 where the seat knew), ``payoff``, ``style``, ``game`` and
``decision`` are int64; ``seed`` and ``rules`` uint64."""


@dataclass(frozen=True)
class ShardInfo:
    path: str
    games: int
    decisions: int


class Shard:
    """One shard's arrays as stored: events ragged, types compact."""

    def __init__(self, arrays: dict[str, NDArray[np.generic]], spec: EncodingSpec) -> None:
        self.arrays = arrays
        self.spec = spec
        lengths = arrays.get("events_len")
        # Where each decision's event rows start.
        self._starts = (
            None
            if lengths is None
            else np.concatenate(([0], np.cumsum(lengths.astype(np.int64))[:-1]))
        )

    @classmethod
    def load(cls, path: Path, spec: EncodingSpec, arrays: Collection[str] | None = None) -> "Shard":
        """Reads ``arrays`` (every one by default) from the shard at ``path``.
        Events need ``events_len``, which is then read too."""
        names = set(ARRAYS if arrays is None else arrays)
        unknown = names - set(ARRAYS)
        if unknown:
            raise ValueError(f"no such arrays: {', '.join(sorted(unknown))}")
        if names & {"events", "event_cards"}:
            names.add("events_len")
        with np.load(path) as npz:
            return cls({name: npz[name] for name in ARRAYS if name in names}, spec)

    def __len__(self) -> int:
        return len(next(iter(self.arrays.values())))

    def take(self, rows: NDArray[np.int64]) -> Batch:
        """The decisions at ``rows``, events padded to the spec's length."""
        batch: Batch = {}
        for name, array in self.arrays.items():
            if name in ("events", "event_cards"):
                continue
            batch[name] = array[rows].astype(_WIDE.get(name, array.dtype), copy=False)
        if "events" in self.arrays or "event_cards" in self.arrays:
            batch.update(self._events(rows))
        return batch

    def _events(self, rows: NDArray[np.int64]) -> dict[str, NDArray[np.generic]]:
        assert self._starts is not None
        lengths = self.arrays["events_len"][rows].astype(np.int64)
        # For every kept event row: the decision it belongs to, and its index.
        owner = np.repeat(np.arange(len(rows)), lengths)
        index = np.arange(int(lengths.sum())) - np.repeat(np.cumsum(lengths) - lengths, lengths)
        source = np.repeat(self._starts[rows], lengths) + index
        out: dict[str, NDArray[np.generic]] = {}
        if "events" in self.arrays:
            width = len(self.spec.event_features)
            events = np.zeros((len(rows), self.spec.max_events, width), np.float32)
            events[owner, index] = self.arrays["events"][source]
            out["events"] = events
        if "event_cards" in self.arrays:
            cards = np.full((len(rows), self.spec.max_events), -1, np.int32)
            cards[owner, index] = self.arrays["event_cards"][source]
            out["event_cards"] = cards
        return out


# The types a Batch has, where they differ from the stored ones.
_WIDE: dict[str, type[np.generic]] = {
    "events_len": np.int32,
    "action": np.int64,
    "seat": np.int64,
    "belief": np.int64,
    "payoff": np.int64,
    "style": np.int64,
    "game": np.int64,
    "decision": np.int64,
}


@dataclass(frozen=True)
class Dataset:
    root: Path
    name: str
    game: str
    encoding: str
    spec: EncodingSpec
    bots: tuple[str, ...]
    """Bot styles, by ``style`` index."""
    shards: tuple[ShardInfo, ...]

    @classmethod
    def open(cls, root: Path) -> "Dataset":
        meta = as_object(json.loads((root / "meta.json").read_text(encoding="utf-8")), "meta")
        shards = tuple(
            ShardInfo(
                path=get_str(s, "path"),
                games=get_int(s, "games"),
                decisions=get_int(s, "decisions"),
            )
            for s in (as_object(item, "shard") for item in get_list(meta, "shards"))
        )
        dataset = cls(
            root=root,
            name=get_str(meta, "name"),
            game=get_str(meta, "game"),
            encoding=get_str(meta, "encoding"),
            spec=EncodingSpec.from_json(get(meta, "spec")),
            bots=get_str_tuple(meta, "bots"),
            shards=shards,
        )
        if dataset.spec.version != dataset.encoding:
            raise ValueError(f"{root}: the spec is {dataset.spec.version}, not {dataset.encoding}")
        return dataset

    @property
    def decisions(self) -> int:
        return sum(s.decisions for s in self.shards)

    def rules(self) -> dict[str, dict[str, object]]:
        """Every rule set played, by id; a ``rules`` value is the first 16
        hex digits of an id."""
        rules: dict[str, dict[str, object]] = {}
        with gzip.open(self.root / "rules.jsonl.gz", "rt", encoding="utf-8") as lines:
            for line in lines:
                entry = as_object(json.loads(line), "rules line")
                rules[get_str(entry, "id")] = as_object(get(entry, "rules"), "rules")
        return rules

    def load(self, shard: int, arrays: Collection[str] | None = None) -> Shard:
        return Shard.load(self.root / self.shards[shard].path, self.spec, arrays)

    def batches(
        self,
        batch_size: int,
        *,
        seed: int,
        shuffle: bool = True,
        drop_last: bool = False,
        arrays: Collection[str] | None = None,
    ) -> Iterator[Batch]:
        """Every decision once, ``batch_size`` at a time: shard by shard,
        shards and rows in an order drawn from ``seed`` (or in order when
        not shuffling). Batches do not span shards."""
        if batch_size < 1:
            raise ValueError("batch_size must be at least 1")
        rng = np.random.default_rng(seed)
        order = rng.permutation(len(self.shards)) if shuffle else np.arange(len(self.shards))
        for i in order:
            shard = self.load(int(i), arrays)
            rows = rng.permutation(len(shard)) if shuffle else np.arange(len(shard))
            for start in range(0, len(rows), batch_size):
                chunk = rows[start : start + batch_size]
                if drop_last and len(chunk) < batch_size:
                    break
                yield shard.take(chunk.astype(np.int64))
