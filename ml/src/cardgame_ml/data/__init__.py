"""Model inputs: encoding specs, and self-play datasets read in batches.

``spec`` reads the layout a game's Rust ``Encode`` implementation reports,
so Python knows the shape of every array without knowing the game.
``shards`` reads the datasets the Rust ``selfplay`` generator writes.
"""
