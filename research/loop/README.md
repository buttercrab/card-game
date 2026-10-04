# Experiment loop

The runner that keeps improving bots unattended (P5), and the protocol for
the agents that drive it. Nothing runs here yet.

The plan for it:

- **Spec:** an experiment states a hypothesis, a config, a compute budget
  and the eval suite that decides it.
- **Queue:** runs on the Mac and on the home server at low priority, beside
  the live bot worker, which must stay responsive.
- **Results:** evaluated automatically and written, with notes, to
  [`../experiments`](../experiments) as any experiment is.
- **What an agent may change:** configs, and `ml/` code on a branch.
  **What it may not:** eval suites, held-out rule sets, anything in
  production.
- **Promotion:** a win repeats on fresh deals, then goes to the owner.
