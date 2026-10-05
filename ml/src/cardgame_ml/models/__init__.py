"""Networks: a belief model (where each hidden card is), then policy and value.

They read the arrays an encoding spec describes (``data.spec``) and score
only legal actions, so no game's rules are built into them. ``belief`` is
the belief model (PyTorch); ``config`` holds model sizes and needs no
PyTorch.
"""
