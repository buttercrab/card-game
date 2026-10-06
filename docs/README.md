# Documentation

Each document has one responsibility. Follow the current implementation for
mechanics and the owner decisions in PLAN for direction; historical experiment
reports describe only their recorded revisions.

| Document | Owns |
| --- | --- |
| [PLAN.md](PLAN.md) | Goal, roadmap status, decisions, acceptance criteria and AI pause |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Crate/web ownership, room data flow and adding a game |
| [DESIGN.md](DESIGN.md) | Implemented design language, tokens, APIs and visual verification |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Setup, checks, generated files and tool commands |
| [OPERATIONS.md](OPERATIONS.md) | Serving/deploy design, verification, stats/privacy and backups |
| [FIXES.md](FIXES.md) | Remaining cleanup and regression contracts |
| [REFACTOR.md](REFACTOR.md) | Delivered cleanup phases 0–7 and evidence limits |
| [Mighty rules](../crates/mighty/RULES.md) | Canonical description of implemented rules |
| [Research](../research/README.md) | Experiment outcomes and artifact conventions |

## Keeping docs current

- Update the owning document with a behavior/contract change. Do not maintain
  a second roadmap in another file.
- Link results instead of copying a historical report into the current plan.
- State revision/date and distinguish implementation, tests, deployment and
  product/strength acceptance.
- Keep resolved decisions out of pending lists. A future milestone or command
  reference does not authorize execution, spending or release.
- Preserve provenance: a stopped run is not an unstarted run, a prepared loop
  is not an operating loop, and cleanup completion is not roadmap completion.

Start at the [repository README](../README.md) for local play.
