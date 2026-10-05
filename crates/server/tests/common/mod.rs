//! What the server's integration tests share: a server on a free port, raw
//! HTTP, WebSocket players, temporary directories, and waiting for a
//! condition with a deadline instead of sleeping a fixed time.

// Each test binary uses its own share of these.
#![allow(dead_code)]

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use server::{AppState, router};
use std::future::Future;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};

pub type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// How long anything a test waits for may take before it fails.
pub const DEADLINE: Duration = Duration::from_secs(10);

/// Serves the API on a free local port.
pub async fn serve(state: AppState) -> SocketAddr {
    serve_web(state, None).await
}

/// Serves the API, and the built client in `web` if given.
pub async fn serve_web(state: AppState, web: Option<PathBuf>) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = router(state, web);
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    addr
}

/// A server with no bot delay and nothing else set.
pub async fn spawn_server() -> SocketAddr {
    serve(AppState::new(Duration::ZERO)).await
}

pub struct Reply {
    pub status: u16,
    /// The status line and headers, lower-cased.
    pub head: String,
    pub body: String,
}

/// One HTTP/1.1 request on its own connection.
///
/// A body goes out only once the server asks for it (`Expect:
/// 100-continue`). A server that refuses a body it has not read answers
/// straight away, so the refusal is always seen: sending a body nobody
/// reads can make the server's side reset the connection, and on Windows a
/// reset throws away the answer before the client reads it.
pub async fn request(addr: SocketAddr, method: &str, path: &str, headers: &[&str], body: &str) -> Reply {
    let mut stream = TcpStream::connect(addr).await.unwrap();
    let extra: String = headers.iter().map(|h| format!("{h}\r\n")).collect();
    let expect = if body.is_empty() {
        ""
    } else {
        "Expect: 100-continue\r\n"
    };
    let head = format!(
        "{method} {path} HTTP/1.1\r\nHost: test\r\nContent-Type: application/json\r\n{extra}{expect}\
         Content-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes()).await.unwrap();
    let mut response = Vec::new();
    if !body.is_empty() {
        let (status, rest) = read_head(&mut stream).await;
        if status == 100 {
            stream.write_all(body.as_bytes()).await.unwrap();
        } else {
            response = rest;
        }
    }
    stream.read_to_end(&mut response).await.unwrap();
    let response = String::from_utf8_lossy(&response).to_string();
    let (head, body) = response.split_once("\r\n\r\n").unwrap_or((&response, ""));
    assert!(head.len() >= 12, "no response: {response:?}");
    Reply {
        status: head[9..12].parse().unwrap(),
        head: head.to_ascii_lowercase(),
        body: body.to_string(),
    }
}

/// Reads up to the end of the first response head; returns its status, and
/// all bytes read when it is not `100 Continue` (whose head is dropped).
async fn read_head(stream: &mut TcpStream) -> (u16, Vec<u8>) {
    let mut read = Vec::new();
    let mut buf = [0u8; 1024];
    loop {
        if let Some(end) = read.windows(4).position(|w| w == b"\r\n\r\n") {
            let status: u16 = String::from_utf8_lossy(&read[9..12]).parse().unwrap();
            if status == 100 {
                return (status, read.split_off(end + 4));
            }
            return (status, read);
        }
        let n = stream.read(&mut buf).await.unwrap();
        assert!(n > 0, "the server closed without answering: {read:?}");
        read.extend_from_slice(&buf[..n]);
    }
}

/// A JSON request: its status and body.
pub async fn http(addr: SocketAddr, method: &str, path: &str, body: &str) -> (u16, String) {
    let reply = request(addr, method, path, &[], body).await;
    (reply.status, reply.body)
}

pub async fn get(addr: SocketAddr, path: &str) -> Reply {
    request(addr, "GET", path, &[], "").await
}

/// Opens a table with `preset`'s rules; returns its id.
pub async fn create_room(addr: SocketAddr, preset: &str) -> String {
    let (status, body) = http(addr, "POST", "/api/rooms", &json!({ "preset": preset }).to_string()).await;
    assert_eq!(status, 200, "{body}");
    serde_json::from_str::<Value>(&body).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string()
}

pub async fn connect(addr: SocketAddr, room: &str) -> Socket {
    connect_async(format!("ws://{addr}/api/rooms/{room}/ws"))
        .await
        .unwrap()
        .0
}

pub async fn send(ws: &mut Socket, msg: Value) {
    ws.send(Message::Text(msg.to_string().into())).await.unwrap();
}

/// The next text message, as JSON; `None` once the socket closes.
pub async fn next_text(ws: &mut Socket) -> Option<Value> {
    let wait = async {
        while let Some(Ok(message)) = ws.next().await {
            if let Message::Text(text) = message {
                return Some(serde_json::from_str(&text).unwrap());
            }
        }
        None
    };
    tokio::time::timeout(DEADLINE, wait).await.expect("timed out")
}

/// Next message of the given type that satisfies `pred`, skipping others.
pub async fn next_where(ws: &mut Socket, kind: &str, pred: impl Fn(&Value) -> bool) -> Value {
    let wait = async {
        loop {
            let value = next_text(ws).await.expect("socket closed");
            if value["type"] == kind && pred(&value) {
                return value;
            }
        }
    };
    tokio::time::timeout(DEADLINE, wait)
        .await
        .unwrap_or_else(|_| panic!("timed out waiting for a {kind}"))
}

pub async fn next(ws: &mut Socket, kind: &str) -> Value {
    next_where(ws, kind, |_| true).await
}

/// Sits down (reclaiming the seat if `token` holds one); returns the seat
/// and its token.
pub async fn join(ws: &mut Socket, name: &str, token: Option<&str>) -> (u64, String) {
    send(ws, json!({ "type": "join", "name": name, "token": token })).await;
    let welcome = next(ws, "welcome").await;
    (
        welcome["seat"].as_u64().unwrap(),
        welcome["token"].as_str().unwrap().to_string(),
    )
}

/// A fresh directory, removed when dropped.
pub fn temp_dir() -> tempfile::TempDir {
    tempfile::Builder::new().prefix("cards-").tempdir().unwrap()
}

/// Checks `cond` every few milliseconds until it holds; fails, naming
/// `what`, once [`DEADLINE`] passes.
pub async fn eventually<F, Fut>(what: &str, mut cond: F)
where
    F: FnMut() -> Fut,
    Fut: Future<Output = bool>,
{
    let wait = async {
        while !cond().await {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    };
    tokio::time::timeout(DEADLINE, wait)
        .await
        .unwrap_or_else(|_| panic!("timed out waiting until {what}"));
}
