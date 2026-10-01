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
    /// How long bots think before acting, in milliseconds.
    #[arg(long, default_value_t = 700)]
    bot_delay_ms: u64,
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();
    let args = Args::parse();
    if !args.web.join("index.html").exists() {
        tracing::warn!("no web client at {}; serving the API only", args.web.display());
    }
    let state = AppState::new(Duration::from_millis(args.bot_delay_ms));
    let listener = tokio::net::TcpListener::bind(args.addr).await?;
    tracing::info!("listening on http://{}", listener.local_addr()?);
    axum::serve(listener, router(state, Some(args.web))).await
}
