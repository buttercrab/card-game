"""Networks: a belief model (where each hidden card is), then policy and value.

They read the arrays an encoding spec describes (``data.spec``) and score
only legal actions, so no game's rules are built into them. ``belief`` is
the belief model (PyTorch), ``q`` the Q network, ``inputs`` the one
observation type and its tensors, ``io`` loading a run's network by its
kind; ``config`` holds model sizes and needs no
PyTorch.
"""
