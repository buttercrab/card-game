"""Training sessions: config differences, and the resume check."""

from pathlib import Path

import pytest

from cardgame_ml.runtime import write_json
from cardgame_ml.train.sessions import (
    ConfigChangedError,
    check_resume,
    config_sha256,
    differences,
    session,
)

RECORDED = {
    "name": "run",
    "seed": 1,
    "budget": {"hands": 100, "hours": 1.0},
    "optim": {"lr": 0.001, "batch_size": 32},
}


def test_budget_may_change_nothing_else() -> None:
    more = {**RECORDED, "budget": {"hands": 200, "hours": 2.0}}
    assert differences(RECORDED, more, ignore=("budget",)) == []
    assert differences(RECORDED, more) == [
        "budget.hands (100 → 200)",
        "budget.hours (1.0 → 2.0)",
    ]
    lr = {**RECORDED, "optim": {"lr": 0.0001, "batch_size": 32}}
    assert differences(RECORDED, lr, ignore=("budget",)) == ["optim.lr (0.001 → 0.0001)"]
    gone = {k: v for k, v in RECORDED.items() if k != "seed"}
    assert differences(RECORDED, gone) == ["seed (1 → absent)"]
    # A key this build added (its default keeps the old behaviour) is no change.
    added = {**RECORDED, "optim": {"lr": 0.001, "batch_size": 32, "new_knob": 0}}
    assert differences(RECORDED, added) == []


def test_a_changed_resume_is_refused_unless_accepted(tmp_path: Path) -> None:
    lr = {**RECORDED, "optim": {"lr": 0.0001, "batch_size": 32}}
    with pytest.raises(ConfigChangedError, match=r"optim\.lr .*--allow-config-change"):
        check_resume(tmp_path, RECORDED, lr, ignore=("budget",))
    changed = check_resume(tmp_path, RECORDED, lr, ignore=("budget",), allow_change=True)
    assert changed == ["optim.lr (0.001 → 0.0001)"]
    assert check_resume(tmp_path, RECORDED, RECORDED, ignore=("budget",)) == []


def test_a_session_entry() -> None:
    entry = session(2, "a" * 40, False, RECORDED, 1, ["optim.lr (0.001 → 0.0001)"])
    assert entry.session == 2
    assert entry.config_sha256 == config_sha256(RECORDED)
    assert entry.config_changed == ("optim.lr (0.001 → 0.0001)",)
    assert entry.to_json()["config_changed"] == ["optim.lr (0.001 → 0.0001)"]
    assert "config_changed" not in session(1, None, True, RECORDED, 1).to_json()
    assert config_sha256(RECORDED) != config_sha256({**RECORDED, "seed": 2})


def test_json_is_written_whole(tmp_path: Path) -> None:
    path = tmp_path / "config.json"
    write_json(path, {"a": 1})
    write_json(path, {"a": 2})
    assert path.read_text(encoding="utf-8") == '{\n  "a": 2\n}\n'
    assert [p.name for p in tmp_path.iterdir()] == ["config.json"]
