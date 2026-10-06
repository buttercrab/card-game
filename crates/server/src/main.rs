use server::{AppState, Config, router};
use std::net::SocketAddr;
use std::time::Duration;
use tracing_subscriber::EnvFilter;

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
    let config = Config::from_args();
    if let Some(dir) = &config.write_generated {
        return server::codegen::write(dir);
    }
    if config.dump_catalog {
        println!("{}", serde_json::to_string_pretty(&server::catalog::catalog())?);
        return Ok(());
    }
    if config.healthcheck {
        return match &config.worker_alive {
            // Heard from within the time the link allows for silence.
            Some(path) if server::bots::alive_within(path, server::bots::SILENCE + Duration::from_secs(15)) => Ok(()),
            Some(path) => Err(std::io::Error::other(format!(
                "the worker has not heard from its server lately ({})",
                path.display()
            ))),
            None => healthcheck(config.addr).await,
        };
    }
    if let Some(url) = &config.bot_worker {
        let Some(token) = config.bot_token.clone() else {
            return Err(std::io::Error::other("--bot-worker needs BOT_TOKEN"));
        };
        let alive = server::bots::Liveness::new(config.worker_alive.clone());
        let think = Duration::from_millis(config.worker_think_ms);
        server::bots::run_worker(url.clone(), token, think, alive).await;
        return Ok(());
    }
    if let Some(web) = &config.web
        && !web.join("index.html").exists()
    {
        tracing::warn!("no web client at {}; serving the API only", web.display());
    }
    let addr = config.addr;
    let state = AppState::new(config);
    if state.config().data.is_some() {
        let restored = state.restore_rooms()?;
        tracing::info!(restored, "restored saved tables");
    }
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("listening on http://{}", listener.local_addr()?);
    // The peer address backs the rate limits when no proxy names the client.
    let app = router(state.clone()).into_make_service_with_connect_info::<SocketAddr>();
    // Open WebSockets would hold a graceful shutdown forever, so on a stop
    // signal the rooms save themselves and the process simply ends; the
    // next server restores them and clients reconnect with their tokens.
    tokio::select! {
        served = axum::serve(listener, app) => served,
        () = stop_signal() => {
            let saved = state.shutdown(Duration::from_secs(5)).await;
            tracing::info!(saved, "stopping; tables saved for the next start");
            Ok(())
        }
    }
}

/// SIGTERM (`docker stop`) or Ctrl-C.
async fn stop_signal() {
    let ctrl_c = async {
        if tokio::signal::ctrl_c().await.is_err() {
            std::future::pending::<()>().await;
        }
    };
    #[cfg(unix)]
    let term = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut term) => {
                term.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {}
        () = term => {}
    }
}
