"""Names and paths the loop builds from queue files and records: crafted
ones (``..``, absolute paths, ``-options``) never reach a folder, an
``rsync`` or an ``rm -rf`` outside the loop's roots; and steps never see
the runner's secrets."""

import json
import os
import subprocess
from pathlib import Path
from typing import cast

import pytest
from loopkit import DMC, EVAL, make_layout, spec

from cardgame_ml.loop.executors import (
    LocalExecutor,
    Places,
    RemoteExecutor,
    checked_workdir,
    collect_argvs,
    run_folder,
    upload_argv,
)
from cardgame_ml.loop.policy import Policy, parse_policy
from cardgame_ml.loop.records import Records, RunRecord, StepRecord
from cardgame_ml.loop.safety import (
    UnsafePathError,
    inside,
    name,
    relative,
    remote_inside,
    step_environment,
)
from cardgame_ml.loop.spec import SpecError, parse_spec
from cardgame_ml.loop.steps import Step
from cardgame_ml.loop.validate import Known, check
from cardgame_ml.schema import SchemaError

CRAFTED = [
    "..",
    ".",
    "../x",
    "a/../../b",
    "/etc",
    "/",
    "-rf",
    "--delete",
    ".hidden",
    "a..b",
    "a/b",
    "UPPER",
    "has space",
    "semi;colon",
    "dollar$(x)",
    "",
    "x" * 129,
    "new\nline",
]


@pytest.mark.parametrize("text", ["a", "2026-10-06-dmc-lr", "eval-hard", "x_1.toml", "a" * 128])
def test_safe_names(text: str) -> None:
    assert name(text, "t") == text


@pytest.mark.parametrize("text", [*CRAFTED, None, 3])
def test_crafted_names_are_refused(text: object) -> None:
    with pytest.raises(UnsafePathError):
        name(text, "t")


@pytest.mark.parametrize("text", ["models/dmc-v1", "models/belief-2/model.onnx", "a/B_c/d.e"])
def test_safe_artifact_paths(text: str) -> None:
    assert relative(text, "t", min_parts=2) == text


@pytest.mark.parametrize(
    "text",
    [
        "models",
        "models/",
        "/models/x",
        "models/../x",
        "models/../../.ssh",
        "../models/x",
        "models//x",
        "models/-x",
        "models/.x",
        "-models/x",
        "models/x y",
        "models/x;rm",
    ],
)
def test_crafted_artifact_paths_are_refused(text: str) -> None:
    with pytest.raises(UnsafePathError):
        relative(text, "t", min_parts=2)


def test_paths_stay_inside_their_root(tmp_path: Path) -> None:
    root = tmp_path / "root"
    root.mkdir()
    (tmp_path / "outside").mkdir()
    assert inside(root, "a", "b") == root / "a" / "b"
    for parts in (("..",), ("..", "outside"), ("a", "..", ".."), ("/etc",)):
        with pytest.raises(UnsafePathError):
            inside(root, *parts)
    with pytest.raises(UnsafePathError):
        inside(root, ".")  # the root itself
    # A symbolic link that leads out is caught when resolved.
    (root / "link").symlink_to(tmp_path / "outside")
    with pytest.raises(UnsafePathError):
        inside(root, "link", "x")


def test_remote_paths_stay_inside_their_root() -> None:
    root = "/home/me/research/card-game"
    assert remote_inside(root, "runs", "f", "s") == f"{root}/runs/f/s"
    for parts in (("..",), ("runs", "..", ".."), ("/etc",), ()):
        with pytest.raises(UnsafePathError):
            remote_inside(root, *parts)
    with pytest.raises(UnsafePathError):
        remote_inside("relative/root", "x")


def test_rsync_upload_is_one_checked_folder(tmp_path: Path) -> None:
    store = tmp_path / "store"
    (store / "models" / "dmc-v1").mkdir(parents=True)
    root = "/home/me/research/card-game"
    argv = upload_argv("home", store, root, "models/dmc-v1")
    assert argv == [
        "rsync",
        "-a",
        "--delete",
        "--",
        f"{store}/models/dmc-v1/",
        f"home:{root}/artifacts/models/dmc-v1/",
    ]
    # Never a whole top folder, a parent, an absolute path or an option.
    for path in ("models", "", "models/..", "../../.ssh", "/etc/x", "-e/x", "models/-x"):
        with pytest.raises(UnsafePathError):
            upload_argv("home", store, root, path)
    with pytest.raises(UnsafePathError):
        upload_argv("-oProxyCommand=x", store, root, "models/dmc-v1")


def test_collect_and_remove_only_a_step_folder(tmp_path: Path) -> None:
    root = "/home/me/research/card-game"
    work = f"{root}/runs/2026-10-06-x/eval-hard"
    assert checked_workdir(root, work) == work
    argvs = collect_argvs("home", root, work, tmp_path / "out", tmp_path / "log")
    assert all(a[:3] == ["rsync", "-a", "--"] for a in argvs)
    assert not any("--delete" in a for a in argvs)
    for crafted in (
        f"{root}/runs",
        f"{root}/runs/x",
        f"{root}/runs/x/../../code/y",
        f"{root}/runs/x/y/z",
        root,
        "/etc",
        "/home/me",
        "runs/x/y",
        f"{root}/runs/-x/y",
    ):
        with pytest.raises(UnsafePathError):
            checked_workdir(root, crafted)


def _run(folder: str, commit: str = "abcdef0123456789") -> RunRecord:
    return RunRecord(
        id="r",
        folder=folder,
        method="eval-only",
        tags=[],
        parent=None,
        confirms=None,
        priority=0,
        commit=commit,
        dirty=False,
        created="2026-10-06T00:00:00Z",
        deadline="2026-10-07T00:00:00Z",
        wall_hours=1.0,
        gpu=False,
        steps=[],
    )


def test_step_names_are_checked() -> None:
    Step("eval-hard", ("x",), "home", 1)
    for crafted in ("../x", "-x", "a/b", ""):
        with pytest.raises(UnsafePathError):
            Step(crafted, ("x",), "home", 1)
    with pytest.raises(ValueError, match="cwd"):
        Step("x", ("x",), "home", 1, cwd="/")


class NoSsh:
    """A shell that fails the test if anything is sent."""

    def __call__(
        self, argv: list[str], stdin: str | None, timeout: float
    ) -> subprocess.CompletedProcess[str] | None:
        raise AssertionError(f"ssh was used: {argv} {stdin}")


@pytest.mark.parametrize(
    ("folder", "commit", "argv"),
    [
        ("../../x", "abcdef0123456789", ("{eval}",)),
        ("-rf", "abcdef0123456789", ("{eval}",)),
        ("f", "--upload-pack=x", ("{eval}",)),
        ("f", "abcdef0123456789", ("--bot", "dmc:{artifacts}/../../.ssh")),
        ("f", "abcdef0123456789", ("--bot", "dmc:{artifacts}/models")),
    ],
)
def test_a_crafted_run_never_reaches_the_home_server(
    tmp_path: Path, folder: str, commit: str, argv: tuple[str, ...]
) -> None:
    layout = make_layout(tmp_path)
    policy = Policy.load(layout.policy)
    home = RemoteExecutor(
        policy.hosts["home"],
        repo=layout.repo,
        artifacts=layout.artifacts,
        experiments=layout.experiments,
        shell=NoSsh(),
    )
    record = StepRecord(Step("eval-hard", argv, "home", 1))
    with pytest.raises(UnsafePathError):
        home.start(_run(folder, commit), record, tmp_path / "log")


def test_a_crafted_run_folder_is_refused_here(tmp_path: Path) -> None:
    layout = make_layout(tmp_path)
    policy = Policy.load(layout.policy)
    mac = LocalExecutor(
        policy.hosts["mac"], Places(layout.repo, layout.artifacts, layout.experiments)
    )
    record = StepRecord(Step("build", ("true",), "mac", 1))
    with pytest.raises(UnsafePathError):
        mac.start(_run("../../escape"), record, tmp_path / "log")
    assert not (tmp_path / "escape").exists()
    with pytest.raises(UnsafePathError):
        layout.run_logs("../x")


def test_crafted_records_are_never_loaded(tmp_path: Path) -> None:
    layout = make_layout(tmp_path)
    records = Records(layout.experiments, layout.live)
    good = _run("2026-10-06-good")
    records.save(good)
    layout.live.mkdir(parents=True, exist_ok=True)
    bad = good.to_json() | {"folder": "../../../etc"}
    (layout.live / "bad.json").write_text(json.dumps(bad), encoding="utf-8")
    worse = good.to_json() | {"folder": "2026-10-06-worse"}
    step = StepRecord(Step("x", ("true",), "mac", 1)).to_json()
    step["step"] = {**cast(dict[str, object], step["step"]), "name": "../../x"}
    worse["steps"] = [step]
    (layout.live / "worse.json").write_text(json.dumps(worse), encoding="utf-8")
    assert [r.folder for r in records.all()] == ["2026-10-06-good"]
    # Set aside with the reason, never deleted.
    quarantined = sorted(p.name for p in records.quarantine.rglob("*") if p.is_file())
    assert quarantined == ["bad.json", "bad.json.reason.txt", "worse.json", "worse.json.reason.txt"]
    assert not (layout.live / "bad.json").exists()
    with pytest.raises(UnsafePathError):
        records.save(_run("../x"))


def test_crafted_specs_are_refused(tmp_path: Path) -> None:
    layout = make_layout(tmp_path)
    policy = Policy.load(layout.policy)
    known = Known([], [])

    def problems(**changes: object) -> list[str]:
        return check(
            parse_spec(spec(EVAL, **changes), "t"), policy, layout.repo, known, researcher=True
        )

    assert problems() == []
    assert problems(options={"bot": "dmc:{artifacts}/models/dmc-v1"}, method="eval-only") == []
    for bot in ("dmc:{artifacts}/../../.ssh", "dmc:{artifacts}/models", "dmc:{artifacts}/-x/y"):
        assert any("artifact" in p for p in problems(method="eval-only", options={"bot": bot}))
    assert any("leading -" in p for p in problems(method="eval-only", options={"bot": "--out=/"}))
    assert any("requires" in p for p in problems(requires=["../../etc"]))
    assert any("requires" in p for p in problems(requires=["/etc/passwd"]))
    for after in ("../x", "-rf", "a/b"):
        with pytest.raises(SpecError):
            parse_spec(spec(EVAL, after=[after]), "t")
    with pytest.raises(SpecError):
        parse_spec(spec(EVAL, id="../x"), "t")


def test_crafted_hosts_are_refused(tmp_path: Path) -> None:
    import tomllib  # noqa: PLC0415

    layout = make_layout(tmp_path)
    with layout.policy.open("rb") as f:
        data = tomllib.load(f)
    for key, value in (("ssh", "-oProxyCommand=sh"), ("ssh", "home x"), ("root", "../x")):
        crafted = json.loads(json.dumps(data))
        crafted["hosts"]["home"][key] = value
        with pytest.raises(SchemaError):
            parse_policy(crafted, "t")


def test_hosts_come_from_the_policys_roles(tmp_path: Path) -> None:
    """Steps go where the policy's roles say, whatever the hosts are called;
    a train host must be this machine with a GPU."""
    import tomllib  # noqa: PLC0415

    from cardgame_ml.loop.methods import METHODS, Context  # noqa: PLC0415
    from cardgame_ml.loop.steps import Role  # noqa: PLC0415

    layout = make_layout(tmp_path)
    with layout.policy.open("rb") as f:
        data = tomllib.load(f)
    for changes, message in (
        ({"train_host": "home"}, "this machine, with a GPU"),
        ({"cost_host": "attic"}, "no host 'attic'"),
    ):
        with pytest.raises(SchemaError, match=message):
            parse_policy({**data, **changes}, "t")
    hosts = {"studio": data["hosts"]["mac"], "rack": data["hosts"]["home"]}
    policy = parse_policy(
        {**data, "hosts": hosts, "train_host": "studio", "cost_host": "rack"}, "t"
    )
    assert policy.hosts["studio"].name == "studio"
    dmc = parse_spec(spec(DMC, resources={"host": "studio", "eval_host": "rack"}), "t")
    plan = METHODS["dmc"].plan(Context(dmc, policy, layout.repo, "x", None))
    assert {s.host for s in plan.steps if s.role != Role.EVAL} == {"studio"}
    costed = spec(EVAL, resources={"host": "studio", "eval_host": "studio"}, evals={"cost": True})
    plan = METHODS["search-tuning"].plan(
        Context(parse_spec(costed, "t"), policy, layout.repo, "y", "hard")
    )
    assert [(s.role, s.host) for s in plan.steps] == [
        (Role.BUILD, "studio"),
        (Role.EVAL, "studio"),
        (Role.COST, "rack"),
    ]


def test_steps_never_see_secrets() -> None:
    env = {
        "PATH": "/bin",
        "HOME": "/h",
        "CARDGAME_ARTIFACTS": "/a",
        "BOT_TOKEN": "x",
        "STATS_TOKEN": "x",
        "ANTHROPIC_API_KEY": "x",
        "AWS_ACCESS_KEY_ID": "x",
        "SSH_AUTH_SOCK": "x",
        "db_password": "x",
        "GH_TOKEN": "x",
    }
    assert step_environment(env) == {"PATH": "/bin", "HOME": "/h", "CARDGAME_ARTIFACTS": "/a"}


def test_a_local_step_gets_no_secrets(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    layout = make_layout(tmp_path)
    policy = Policy.load(layout.policy)
    monkeypatch.setenv("BOT_TOKEN", "secret-bot")
    monkeypatch.setenv("STATS_TOKEN", "secret-stats")
    mac = LocalExecutor(
        policy.hosts["mac"], Places(layout.repo, layout.artifacts, layout.experiments)
    )
    out = tmp_path / "env.txt"
    record = StepRecord(Step("probe", ("sh", "-c", f"env > {out}"), "mac", 1))
    log = layout.logs / "2026-10-06-r" / "probe.log"
    mac.start(_run("2026-10-06-r"), record, log)
    assert record.pid is not None
    _, status = os.waitpid(record.pid, 0)
    assert status == 0
    text = out.read_text(encoding="utf-8")
    assert "PATH=" in text
    assert "secret-bot" not in text
    assert "secret-stats" not in text


def test_remote_step_folders() -> None:
    assert run_folder("/home/me/r", _run("f"), "s") == "/home/me/r/runs/f/s"
    for folder, step in (("f", "../s"), ("../f", "s"), ("f", "-s")):
        with pytest.raises(UnsafePathError):
            run_folder("/home/me/r", _run(folder), step)
