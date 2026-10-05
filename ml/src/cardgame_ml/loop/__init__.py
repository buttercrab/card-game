"""The experiment loop (P5): experiments queued as specs, run unattended on
the Mac and the home server, scored the same way, and reported daily.

- ``spec``: an experiment spec (TOML) and its validation; ``policy`` the
  loop's fixed rules (``research/loop/policy.toml``): hosts, limits, the
  scoring protocol.
- ``methods``: the registry of method runners (``dmc``, ``belief``,
  ``eval-only``, ``search-tuning``); each turns a spec into steps.
- ``scheduler``: the queue and the long-running runner (one GPU job at
  a time, thread caps per host, budgets, resume after a restart);
  ``executors`` start steps here or on the home server.
- ``records``: each run's folder in ``research/experiments/``;
  ``evals`` reads suite results and compares a run with its parent;
  ``promotion`` queues confirmations on fresh deals.
- ``leaderboard`` and ``daily``: the leaderboard, plots and daily reports.
- ``researcher``: the headless research agent that refills the queue.

``python -m cardgame_ml.loop`` is the command line (``run``, ``status``,
``report``, ``validate``, ``research``); ``research/loop/README.md`` says
how it all fits.
"""
