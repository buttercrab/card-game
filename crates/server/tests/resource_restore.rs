//! A preserved resource refusal is a bounded HTTP outcome before WS upgrade.
mod common;

use common::*;
use serde_json::{Value, json};
use server::{AppState, Config};

#[tokio::test]
async fn preserved_snapshot_capacity_is_507_for_lookup_and_socket_upgrade() {
    let dir = temp_dir();
    let path = dir.path().join("saved.json");
    let original = vec![b'!'; 129];
    std::fs::write(&path, &original).unwrap();
    let app = AppState::new(Config {
        data: Some(dir.path().into()),
        resource_snapshot_bytes: 128,
        ..config()
    });
    assert_eq!(app.restore_rooms().unwrap(), 0);
    let addr = serve(app).await;
    let expected = json!({"code":"resource_capacity","reason":{"code":"capacity","resource":"snapshot","limit":128}});
    let response = get(addr, "/api/rooms/saved").await;
    assert_eq!(response.status, 507);
    assert_eq!(serde_json::from_str::<Value>(&response.body).unwrap(), expected);
    let error = tokio_tungstenite::connect_async(format!("ws://{addr}/api/rooms/saved/ws"))
        .await
        .expect_err("no socket or normal greeting is manufactured");
    let tokio_tungstenite::tungstenite::Error::Http(response) = error else {
        panic!("expected explicit HTTP capacity refusal: {error:?}");
    };
    assert_eq!(response.status().as_u16(), 507);
    assert_eq!(
        serde_json::from_slice::<Value>(response.body().as_ref().unwrap()).unwrap(),
        expected
    );
    assert_eq!(get(addr, "/api/rooms/missing").await.status, 404);
    assert_eq!(std::fs::read(&path).unwrap(), original);
    assert!(!path.with_extension("bad").exists());
}

#[tokio::test]
async fn uncheckpointable_creation_refuses_before_actor_file_or_statistics() {
    let dir = temp_dir();
    let app = AppState::new(Config {
        data: Some(dir.path().into()),
        resource_snapshot_bytes: 128,
        ..config()
    });
    let inspect = app.clone();
    let stats = app.stats();
    let addr = serve(app).await;
    let (status, body) = http(addr, "POST", "/api/rooms", r#"{"preset":"gshs"}"#).await;
    assert_eq!(status, 507);
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap(),
        json!({"code":"resource_capacity","reason":{"code":"capacity","resource":"snapshot","limit":128}})
    );
    assert_eq!(inspect.open_rooms(), 0);
    assert_eq!(stats.summary(server::stats::now()).totals.tables, 0);
    assert!(
        std::fs::read_dir(dir.path()).unwrap().all(|entry| entry
            .unwrap()
            .path()
            .extension()
            .is_none_or(|ext| ext != "json"))
    );
}

#[tokio::test]
async fn creation_reserves_recovery_against_effective_delivery_limit() {
    let app = AppState::new(Config {
        outbound_message_bytes: 1024,
        outbound_connection_bytes: 4096,
        outbound_global_bytes: 8192,
        ..config()
    });
    let inspect = app.clone();
    let addr = serve(app).await;
    let (status, body) = http(addr, "POST", "/api/rooms", r#"{"preset":"gshs"}"#).await;
    assert_eq!(status, 507);
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap(),
        json!({"code":"resource_capacity","reason":{"code":"capacity","resource":"session","limit":1024}})
    );
    assert_eq!(inspect.open_rooms(), 0);
}
