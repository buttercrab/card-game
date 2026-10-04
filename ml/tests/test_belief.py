"""The belief model on CPU: shapes, masking, the count baseline, padding."""

import math

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from cardgame_ml.data.shards import Batch, Dataset  # noqa: E402
from cardgame_ml.models.belief import (  # noqa: E402
    BeliefConfig,
    BeliefModel,
    card_losses,
    class_counts,
    log_probs,
    uniform_log_probs,
)
from cardgame_ml.train.batching import batches as split_batches  # noqa: E402
from cardgame_ml.train.batching import every_row, to_inputs  # noqa: E402

TINY = BeliefConfig(width=16, heads=2, layers=1, feedforward=32, dropout=0.0)


@pytest.fixture(scope="module")
def batch(dataset: Dataset) -> Batch:
    return next(split_batches(dataset, every_row, 64, seed=0))


def model(dataset: Dataset, seed: int = 0) -> BeliefModel:
    torch.manual_seed(seed)
    return BeliefModel(dataset.spec, TINY).eval()


def test_logits_have_a_row_per_card_and_a_column_per_class(dataset: Dataset, batch: Batch) -> None:
    logits = model(dataset)(*to_inputs(batch, torch.device("cpu")))
    spec = dataset.spec
    assert logits.shape == (len(batch["belief"]), len(spec.cards), len(spec.belief_classes))
    assert torch.isfinite(logits).all()


def test_padding_events_change_nothing(dataset: Dataset, batch: Batch) -> None:
    """Events cut to the longest sequence, or padded to the spec's length
    with garbage past each decision's own, give the same logits."""
    m = model(dataset, seed=1)
    with torch.no_grad():
        cut = m(*to_inputs(batch, torch.device("cpu")))
        noisy = dict(batch)
        past = np.arange(dataset.spec.max_events)[None, :] >= batch["events_len"][:, None]
        noisy["events"] = batch["events"] + np.float32(5) * past[..., None]
        noisy["event_cards"] = np.where(past, 7, batch["event_cards"])
        full = m(
            torch.as_tensor(noisy["global"]),
            torch.as_tensor(noisy["cards"]),
            torch.as_tensor(noisy["events"]),
            torch.as_tensor(noisy["event_cards"].astype(np.int64)),
            torch.as_tensor(noisy["events_len"].astype(np.int64)),
        )
    assert torch.allclose(cut, full, atol=1e-5)


def test_counts_are_the_hidden_cards_per_class(batch: Batch) -> None:
    targets = torch.as_tensor(batch["belief"])
    counts = class_counts(targets, 9)
    for row, count in zip(batch["belief"], counts.numpy(), strict=True):
        assert np.array_equal(count, np.bincount(row[row >= 0], minlength=9))


def test_a_fresh_model_is_the_count_baseline(dataset: Dataset, batch: Batch) -> None:
    """The head starts at zero, so before training the model's
    distribution is the count baseline's exactly."""
    targets = torch.as_tensor(batch["belief"])
    counts = class_counts(targets, 9)
    logits = model(dataset)(*to_inputs(batch, torch.device("cpu")))
    ours = log_probs(logits, counts)
    base = uniform_log_probs(counts, logits.shape[1])
    assert torch.equal(ours, base)
    loss, _ = card_losses(base, targets)
    assert 0 < loss.mean() < math.log(9)


def test_classes_without_hidden_cards_get_nothing() -> None:
    logits = torch.tensor([[[3.0, 0.0, -1.0]]])
    counts = torch.tensor([[0, 2, 1]])
    p = log_probs(logits, counts).exp()
    assert p[0, 0, 0] == 0
    # In proportion to count * exp(logit).
    expected = torch.tensor([2.0, math.exp(-1.0)])
    assert torch.allclose(p[0, 0, 1:], expected / expected.sum())


def test_a_position_with_nothing_hidden_has_finite_gradients(dataset: Dataset) -> None:
    m = BeliefModel(dataset.spec, TINY)
    logits = torch.zeros(2, 54, 9, requires_grad=True)
    targets = torch.full((2, 54), -1)
    targets[0, 3] = 2
    losses, _ = card_losses(log_probs(logits, class_counts(targets, 9)), targets)
    torch.autograd.backward(losses.mean())
    assert logits.grad is not None
    assert torch.isfinite(logits.grad).all()
    assert m.parameter_count() > 0


def test_card_losses_score_only_hidden_cards() -> None:
    log_p = torch.log(torch.tensor([[[0.5, 0.25, 0.25], [0.1, 0.8, 0.1]]]))
    targets = torch.tensor([[1, -1]])
    losses, correct = card_losses(log_p, targets)
    assert torch.allclose(losses, torch.tensor([math.log(4)]))
    assert not correct.any()
    assert len(correct) == 1
