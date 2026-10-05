"""Deep Monte Carlo (DMC): a Q network learnt from self-play alone.

As in DouZero (2021): actor processes play whole hands with the current
network in every seat (ε-greedy), every decision is labelled with the
acting seat's final payoff, and a learner regresses
``Q(observation, action)`` onto it. No search, no bootstrapping, no
human or bot data: the network starts from random weights and the only
signal is the payoff of its own hands.

``config`` is the run's typed config, ``actor`` the playing processes,
``buffer`` what they send and the replay buffer, ``learner`` the
training loop, ``curve`` the learning curve's fixed measurement and
``policy`` how a Q network picks actions. Run it with ``python -m
cardgame_ml.train.dmc --config <config.toml>``.
"""
