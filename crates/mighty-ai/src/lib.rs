//! Bots for Mighty (`mighty`).
//!
//! - [`SimpleBot`]: rules of thumb. It fills an empty seat on its own and
//!   plays every seat inside the searches' playouts; [`Clumsy`] slips now
//!   and then, as the table's 초보.
//! - [`SearchBot`]: Perfect Information Monte Carlo ([`pimc`]). It deals
//!   the cards it cannot see many ways ([`Sampler`]), weighs each deal by
//!   how well it explains the other players' bids and cards ([`Reading`]),
//!   plays every candidate out with the simple bot, the last tricks solved
//!   exactly if asked ([`endgame`]), and keeps a move only when it beats
//!   the simple bot's by enough.
//! - [`HybridBot`]: the search leaning on a Q network.
//! - [`LevelBots`]: what the table's levels ([`mighty::bot::Level`]) play
//!   as.

mod deal;
pub mod endgame;
mod hybrid;
mod level;
pub mod pimc;
mod read;
mod search;
mod seen;
mod simple;

pub use deal::Sampler;
pub use hybrid::{Baseline, HybridBot};
pub use level::LevelBots;
pub use pimc::play_out;
pub use read::Reading;
pub use search::{SearchBot, candidates};
pub use seen::{Seen, SeenPhase};
pub use simple::{Clumsy, EASY_CAUTION, EASY_SLIPS, SimpleBot, TEMPER, tempered};
