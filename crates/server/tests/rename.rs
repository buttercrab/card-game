//! A user rename is a scoped operation, distinct from credential bootstrap.
mod common;
use common::*;
use serde_json::json;

#[tokio::test]
async fn scoped_rename_crosses_wire_and_replays_receipt_without_bootstrap_or_duplicate_edit() {
    let addr = spawn_server().await;
    let id = create_room(addr, "gshs").await;
    let mut ws = connect(addr, &id).await;
    next(&mut ws, "room").await;
    send(&mut ws, json!({"type":"observe","name":"Alice"})).await;
    let original = next(&mut ws, "visitor_welcome").await;
    let room = next(&mut ws, "room").await;
    let window = next_where(&mut ws, "room_command_window", |message| {
        message["command"]["scope"]["version"] == room["room_version"]
    })
    .await;
    let request = json!({"type":"submit_room","operation_id":"1:rename","sequence":1,"expected":window["command"]["scope"],"action":{"type":"rename","name":"  새 이름  "}});
    send(&mut ws, request.clone()).await;
    let renamed = next(&mut ws, "visitor_welcome").await;
    assert_eq!(renamed["id"], original["id"]);
    assert_eq!(renamed["token"], original["token"]);
    assert_eq!(renamed["name"], "새 이름");
    assert!(renamed["seat"].is_null());
    let receipt = next(&mut ws, "operation_receipt").await;
    assert_eq!(receipt["outcome"]["status"], "accepted");
    let published = next(&mut ws, "room").await;
    assert_eq!(published["room_version"], receipt["outcome"]["version"]);
    assert_eq!(published["observers"][0]["id"], original["id"]);
    assert_eq!(published["observers"][0]["name"], "새 이름");
    next(&mut ws, "room_command_window").await;
    send(&mut ws, request).await;
    assert_eq!(
        next_text(&mut ws).await.unwrap(),
        receipt,
        "duplicate emits only its saved receipt"
    );
    send(&mut ws, json!({"type":"rename","name":"unscoped"})).await;
    assert_eq!(next(&mut ws, "error").await["code"], "bad_message");
    send(&mut ws, json!({"type":"submit_room","operation_id":"2:stale","sequence":2,"expected":window["command"]["scope"],"action":{"type":"rename","name":"stale"}})).await;
    assert_eq!(
        next(&mut ws, "operation_receipt").await["outcome"],
        json!({"status":"rejected","reason":"stale_scope","error":null})
    );
    let unchanged = next(&mut ws, "room").await;
    assert_eq!(unchanged["observers"][0]["name"], "새 이름");
}
