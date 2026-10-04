"""Model inputs: encoding specs now; self-play shards and batching from P2.

``spec`` reads the layout a game's Rust ``Encode`` implementation reports,
so Python knows the shape of every array without knowing the game.
"""
