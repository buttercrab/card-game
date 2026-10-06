//! The bot levels players pick at the table, as the protocol and the
//! catalog name them. The bots themselves (the simple bot, the search and
//! what the levels build) are in the `mighty-ai` crate.

/// How well a bot plays: the levels players pick at the table. Defined
/// once here for the server, the environment, `sim` and the evals alike.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
#[ts(rename = "BotLevel")]
pub enum Level {
    /// 초보: the simple bot, bidding more carefully and slipping now and
    /// then when it plays a card.
    Easy,
    /// 보통: the simple bot.
    Normal,
    /// 고수: the search bot; the strongest.
    #[default]
    Hard,
}

impl Level {
    pub const ALL: [Level; 3] = [Level::Easy, Level::Normal, Level::Hard];

    /// Its name at the table.
    pub fn label(self) -> &'static str {
        match self {
            Level::Easy => "초보",
            Level::Normal => "보통",
            Level::Hard => "고수",
        }
    }

    /// Its name in specs and on the wire.
    pub fn name(self) -> &'static str {
        match self {
            Level::Easy => "easy",
            Level::Normal => "normal",
            Level::Hard => "hard",
        }
    }
}

impl std::fmt::Display for Level {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.name())
    }
}

impl std::str::FromStr for Level {
    type Err = String;

    /// By its name in specs or at the table: `hard` or `고수`.
    fn from_str(s: &str) -> Result<Level, String> {
        Level::ALL
            .into_iter()
            .find(|l| l.name() == s || l.label() == s)
            .ok_or_else(|| format!("unknown level `{s}`"))
    }
}
