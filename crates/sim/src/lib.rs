//! Bots by name ([`spec`]), for the `sim` simulator, the experiments
//! (`lab`), the evals and the environment; and `sim` itself, which plays
//! thousands of games with them and checks every invariant after every
//! step (through `harness`).

pub mod phased;
pub mod spec;
