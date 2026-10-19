//! Atomic card decisions use one scoped wire operation and one publication.
mod common;
use common::*;
use serde_json::json;

#[tokio::test]
async fn discard_batch_publishes_only_the_final_hand_and_replays_one_receipt() {
    let addr = spawn_server().await;
    let room = create_room(addr, "gshs").await;
    let mut player = connect(addr, &room).await;
    let (seat, _) = join(&mut player, "Batch player", None).await;
    assert_eq!(seat, 0);
    let mut observer = connect(addr, &room).await;
    send(&mut observer, json!({"type":"observe","name":"Batch observer"})).await;
    next(&mut observer, "visitor_welcome").await;
    for seat in 1..5 {
        send(&mut player, json!({"type":"add_bot","seat":seat})).await;
    }
    send(&mut player, json!({"type":"start"})).await;
    let bidding = next_where(&mut player, "state", |state| {
        state["legal"]
            .as_array()
            .is_some_and(|actions| actions.iter().any(|action| action["Bid"]["count"] == 20))
    })
    .await;
    let bid = bidding["legal"]
        .as_array()
        .unwrap()
        .iter()
        .find(|action| action["Bid"]["count"] == 20)
        .unwrap();
    send(&mut player, json!({"type":"act","action":bid})).await;
    let exchange = next_where(&mut player, "state", |state| {
        state["legal"]
            .as_array()
            .is_some_and(|actions| actions.iter().any(|action| action.get("Discard").is_some()))
    })
    .await;
    let before = exchange["view"]["hand"].as_array().unwrap().len();
    let hand_size = exchange["view"]["rules"]["hand_size"].as_u64().unwrap() as usize;
    let count = before - hand_size;
    assert!(count > 1);
    let actions: Vec<_> = exchange["legal"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|action| action.get("Discard").is_some())
        .take(count)
        .cloned()
        .collect();
    let sequence = exchange["command"]["next_sequence"].as_u64().unwrap();
    let expected = exchange["command"]["scope"].clone();
    let version = exchange["version"].as_u64().unwrap();
    let request = json!({"type":"submit_batch","operation_id":format!("{sequence}:discard"),"sequence":sequence,"expected":expected,"actions":actions});
    send(&mut player, request.clone()).await;
    let accepted = next(&mut player, "operation_receipt").await;
    assert_eq!(accepted["outcome"], json!({"status":"accepted","version":version+1}));
    let published = next_where(&mut player, "state", |state| {
        state["version"].as_u64().is_some_and(|v| v > version)
    })
    .await;
    assert_eq!(published["version"], version + 1);
    assert_eq!(published["view"]["hand"].as_array().unwrap().len(), hand_size);
    assert_eq!(
        published["view"]["phase"]["Exchange"]["discards"]
            .as_array()
            .unwrap()
            .len(),
        count
    );
    let public = next_where(&mut observer, "state", |state| {
        state["version"].as_u64().is_some_and(|v| v > version)
    })
    .await;
    assert_eq!(public["view"]["hand_sizes"][0], hand_size);
    assert!(public["view"]["hand"].as_array().unwrap().is_empty());
    assert!(public["view"]["phase"]["Exchange"]["discards"].is_null());
    send(&mut player, request).await;
    assert_eq!(next(&mut player, "operation_receipt").await, accepted);
}
