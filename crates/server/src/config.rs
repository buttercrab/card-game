//! The server's settings, read once at start: command-line flags, and the
//! secrets and site settings from the environment (each may also be given
//! as a flag, but a flag shows in `ps`; prefer the environment for secrets).

use clap::Parser;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

/// A table with nobody connected closes after this many minutes, unless
/// the server is told otherwise.
pub const IDLE_MINUTES: u64 = 30;

/// Serve the card game: the API, WebSockets and the built web client.
#[derive(Parser, Debug, Clone)]
#[command(name = "server")]
pub struct Config {
    #[arg(long, default_value = "127.0.0.1:3030")]
    pub addr: SocketAddr,
    /// Directory with the built web client (`npm run build` in web/).
    #[arg(long, default_value = "web/dist")]
    pub web: Option<PathBuf>,
    /// The unit of a bot's move time, in milliseconds: at 1000 bots bid in
    /// 2 to 3 s, lead in about 2 s and follow an obvious card in about
    /// 0.6 s (`room::bots::pace`); 고수 bots think through most of it.
    #[arg(long, default_value_t = 1000)]
    pub bot_delay_ms: u64,
    /// Cap on how long a 고수 bot thinks per move, in milliseconds. By
    /// default it uses most of the bot delay; lower it on small servers.
    #[arg(long)]
    pub bot_think_ms: Option<u64>,
    /// Most tables open at once.
    #[arg(long, default_value_t = 500)]
    pub max_rooms: usize,
    /// Close a table after this many minutes with nobody connected.
    #[arg(long, default_value_t = IDLE_MINUTES as f64)]
    pub idle_minutes: f64,
    /// Save tables here so they survive restarts and deploys.
    #[arg(long)]
    pub data: Option<PathBuf>,
    /// Instead of serving, think for the bots of the server at this URL
    /// (wss://host/internal/bots). Needs BOT_TOKEN.
    #[arg(long)]
    pub bot_worker: Option<String>,
    /// The most a worker thinks per move, in milliseconds; rooms ask for
    /// less at faster paces.
    #[arg(long, default_value_t = 3000)]
    pub worker_think_ms: u64,
    /// Ask the server at --addr whether it is up, then exit (for container
    /// health checks). With --worker-alive, ask the worker instead: whether
    /// it heard from its server in the last minute.
    #[arg(long)]
    pub healthcheck: bool,
    /// Write the web client's generated files (the protocol's types) into
    /// this directory, `web/src/lib/generated`, then exit.
    #[arg(long)]
    pub write_generated: Option<PathBuf>,
    /// Print the catalog (the games, bot levels, the table's choices and
    /// limits, and each game's own: its presets) as JSON, then exit.
    #[arg(long)]
    pub dump_catalog: bool,
    /// A worker keeps this file fresh while its server talks to it.
    #[arg(long)]
    pub worker_alive: Option<PathBuf>,
    /// The secret a bot worker presents. A server with one takes a worker
    /// (and warns while none is connected); a worker needs it to dial in.
    #[arg(long, env = "BOT_TOKEN", hide_env_values = true)]
    pub bot_token: Option<String>,
    /// The secret that opens `/stats`; without one, it does not exist.
    #[arg(long, env = "STATS_TOKEN", hide_env_values = true)]
    pub stats_token: Option<String>,
    /// Cloudflare Web Analytics token, if pages should load its beacon.
    #[arg(long, env = "CF_BEACON_TOKEN")]
    pub beacon: Option<String>,
    /// The site's own address, for canonical links and the sitemap.
    #[arg(long, env = "SITE_URL", default_value = crate::site::SITE_URL)]
    pub site_url: String,
    /// The salt for players' ids in the stats; by default one kept in
    /// `<data>/stats-salt` (made on first use), or one per process.
    #[arg(long, env = "STATS_SALT", hide_env_values = true)]
    pub stats_salt: Option<String>,
}

impl Default for Config {
    /// What the server runs with when given no flags and no environment.
    fn default() -> Config {
        Config::parse_without_env(["server"])
    }
}

impl Config {
    /// Reads the flags and the environment of this process.
    pub fn from_args() -> Config {
        Config::parse().normalized()
    }

    /// Reads `args` as if the environment were empty.
    fn parse_without_env<I, T>(args: I) -> Config
    where
        I: IntoIterator<Item = T>,
        T: Into<std::ffi::OsString> + Clone,
    {
        use clap::{CommandFactory, FromArgMatches};
        let command = Config::command().mut_args(|arg| arg.env(None::<&str>));
        let matches = command.get_matches_from(args);
        Config::from_arg_matches(&matches)
            .expect("the flags parse")
            .normalized()
    }

    /// Blank values count as unset; addresses lose a trailing slash.
    fn normalized(mut self) -> Config {
        for value in [
            &mut self.bot_token,
            &mut self.stats_token,
            &mut self.beacon,
            &mut self.stats_salt,
        ] {
            *value = value.take().map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
        }
        let site = self.site_url.trim().trim_end_matches('/');
        self.site_url = if site.is_empty() {
            crate::site::SITE_URL.to_string()
        } else {
            site.to_string()
        };
        self
    }

    pub fn bot_delay(&self) -> Duration {
        Duration::from_millis(self.bot_delay_ms)
    }

    pub fn bot_think(&self) -> Option<Duration> {
        self.bot_think_ms.map(Duration::from_millis)
    }

    /// How long a table with nobody connected stays open.
    pub fn idle(&self) -> Duration {
        Duration::try_from_secs_f64(self.idle_minutes * 60.0).unwrap_or(Duration::from_secs(IDLE_MINUTES * 60))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_defaults_read_no_environment() {
        let config = Config::default();
        assert_eq!(config.bot_delay(), Duration::from_secs(1));
        assert_eq!(config.idle(), Duration::from_secs(IDLE_MINUTES * 60));
        assert_eq!(config.site_url, crate::site::SITE_URL);
        assert!(config.bot_token.is_none() && config.stats_token.is_none());
        assert_eq!(config.web.as_deref(), Some(std::path::Path::new("web/dist")));
    }

    #[test]
    fn flags_parse_and_blank_secrets_are_unset() {
        let config = Config::parse_without_env([
            "server",
            "--bot-delay-ms",
            "50",
            "--idle-minutes",
            "0.5",
            "--stats-token",
            "  ",
            "--site-url",
            "https://example.com/",
            "--bot-think-ms",
            "150",
        ]);
        assert_eq!(config.bot_delay(), Duration::from_millis(50));
        assert_eq!(config.idle(), Duration::from_secs(30));
        assert_eq!(config.stats_token, None);
        assert_eq!(config.site_url, "https://example.com");
        assert_eq!(config.bot_think(), Some(Duration::from_millis(150)));
    }
}
