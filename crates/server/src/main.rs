use clap::Parser;
use server::{AppState, router};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;
use tracing_subscriber::EnvFilter;

/// Serve the card game: the API, WebSockets and the built web client.
#[derive(Parser)]
struct Args {
    #[arg(long, default_value = "127.0.0.1:3030")]
    addr: SocketAddr,
    /// Directory with the built web client (`npm run build` in web/).
    #[arg(long, default_value = "web/dist")]
    web: PathBuf,
    /// How long a 보통 bot's move takes, in milliseconds; 초보 bots are
    /// quicker and 고수 bots take longer, thinking all the while.
    #[arg(long, default_value_t = 1000)]
    bot_delay_ms: u64,
    /// Cap on how long a 고수 bot thinks per move, in milliseconds. By
    /// default it uses most of the bot delay; lower it on small servers.
    #[arg(long)]
    bot_think_ms: Option<u64>,
    /// Most tables open at once.
    #[arg(long, default_value_t = 500)]
    max_rooms: usize,
    /// Close a table after this many minutes with nobody connected.
    #[arg(long, default_value_t = 30)]
    idle_minutes: u64,
    /// Save tables here so they survive restarts and deploys.
    #[arg(long)]
    data: Option<PathBuf>,
    /// Instead of serving, think for the bots of the server at this URL
    /// (wss://host/internal/bots). Needs BOT_TOKEN.
    #[arg(long)]
    bot_worker: Option<String>,
    /// The most a worker thinks per move, in milliseconds; rooms ask for
    /// less at faster paces.
    #[arg(long, default_value_t = 3000)]
    worker_think_ms: u64,
    /// Ask the server at --addr whether it is up, then exit (for container health checks).
    #[arg(long)]
    healthcheck: bool,
}

/// Exits successfully when the server at `addr` answers /healthz.
async fn healthcheck(addr: SocketAddr) -> std::io::Result<()> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let host = SocketAddr::new(std::net::Ipv4Addr::LOCALHOST.into(), addr.port());
    let mut stream = tokio::net::TcpStream::connect(host).await?;
    stream
        .write_all(b"GET /healthz HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .await?;
    let mut response = String::new();
    stream.read_to_string(&mut response).await?;
    // The web client's catch-all also answers 200, so check the body too.
    if response.starts_with("HTTP/1.1 200") && response.ends_with("\r\n\r\nok") {
        Ok(())
    } else {
        Err(std::io::Error::other(response))
    }
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();
    let args = Args::parse();
    if args.healthcheck {
        return healthcheck(args.addr).await;
    }
    let token = std::env::var("BOT_TOKEN").ok().filter(|t| !t.is_empty());
    if let Some(url) = args.bot_worker {
        let Some(token) = token else {
            return Err(std::io::Error::other("--bot-worker needs BOT_TOKEN"));
        };
        server::bots::run_worker::<mighty::Mighty>(url, token, Duration::from_millis(args.worker_think_ms)).await;
        return Ok(());
    }
    if !args.web.join("index.html").exists() {
        tracing::warn!("no web client at {}; serving the API only", args.web.display());
    }
    let mut state = AppState::new(Duration::from_millis(args.bot_delay_ms))
        .with_limits(args.max_rooms, Duration::from_secs(args.idle_minutes * 60));
    if let Some(token) = token {
        state = state.with_bot_token(token);
    }
    if let Some(ms) = args.bot_think_ms {
        state = state.with_bot_think(Duration::from_millis(ms));
    }
    // The owner's /stats page, the analytics beacon and the site's address.
    let env = |name: &str| std::env::var(name).ok().filter(|v| !v.trim().is_empty());
    if let Some(token) = env("STATS_TOKEN") {
        state = state.with_stats_token(token);
    }
    if let Some(token) = env("CF_BEACON_TOKEN") {
        state = state.with_beacon(token.trim().to_string());
    }
    if let Some(url) = env("SITE_URL") {
        state = state.with_site_url(url);
    }
    if let Some(dir) = args.data {
        state = state.with_data(dir);
        let restored = state.restore_rooms()?;
        tracing::info!(restored, "restored saved tables");
    }
    let listener = tokio::net::TcpListener::bind(args.addr).await?;
    tracing::info!("listening on http://{}", listener.local_addr()?);
    // The peer address backs the rate limits when no proxy names the client.
    let app = router(state, Some(args.web)).into_make_service_with_connect_info::<SocketAddr>();
    axum::serve(listener, app).await
}
