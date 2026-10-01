//! What a room needs from a game beyond one hand: table size, how each hand
//! is set up, and a bot to fill empty seats.

use engine::{Bot, Game};
use mighty::Mighty;
use mighty::rules::Preset;
use mighty::search::SearchBot;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

pub trait SessionGame:
    Game<State: Send, Action: Serialize + DeserializeOwned + Send + 'static, View: Serialize + Send + 'static>
    + Send
    + 'static
{
    type Settings: Clone + Serialize + Send + 'static;

    const NAME: &'static str;

    fn seats(settings: &Self::Settings) -> usize;

    /// Options for hand number `hand` (0-based) of a session.
    fn hand_options(settings: &Self::Settings, hand: u32) -> Self::Options;

    fn bot() -> Box<dyn Bot<Self> + Send>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct MightySettings {
    pub preset: Preset,
}

impl Default for MightySettings {
    fn default() -> MightySettings {
        MightySettings { preset: Preset::Gshs }
    }
}

impl SessionGame for Mighty {
    type Settings = MightySettings;

    const NAME: &'static str = "mighty";

    fn seats(settings: &MightySettings) -> usize {
        settings.preset.rules().players
    }

    /// The first bidder moves one seat to the left each hand.
    fn hand_options(settings: &MightySettings, hand: u32) -> mighty::Options {
        let rules = settings.preset.rules();
        let first_bidder = hand as usize % rules.players;
        mighty::Options { rules, first_bidder }
    }

    fn bot() -> Box<dyn Bot<Mighty> + Send> {
        Box::new(SearchBot::default())
    }
}
