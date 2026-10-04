"""Export trained models to ONNX for ``crates/infer``.

Every export is checked for parity: the Rust runtime and PyTorch must give
the same outputs on recorded positions. Arrives in P3.
"""
