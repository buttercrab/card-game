//! The site around the game: pages and their status codes, robots and
//! sitemap, the stats page, client error reports and rate limits.

mod common;

use common::*;
use serde_json::{Value, json};
use server::AppState;
use std::time::Duration;

const INDEX: &str = r#"<!doctype html>
<html lang="ko">
  <head>
    <meta name="description" content="친구들과 마이티 한 판" />
    <meta property="og:title" content="마이티 한 판 하실래요?" />
    <meta property="og:description" content="링크를 누르면 바로 테이블에 앉아요." />
    <title>마이티</title>
  </head>
  <body><div id="app"></div></body>
</html>"#;

/// A built client with an index, a hashed asset and a public file.
fn web_dir() -> tempfile::TempDir {
    let dir = temp_dir();
    let root = dir.path();
    std::fs::create_dir_all(root.join("assets")).unwrap();
    std::fs::create_dir_all(root.join("music")).unwrap();
    std::fs::write(root.join("index.html"), INDEX).unwrap();
    std::fs::write(root.join("assets/index-abc12345.js"), "console.log(1)").unwrap();
    std::fs::write(root.join("og.png"), "png").unwrap();
    std::fs::write(root.join("music/a.mp3"), "mp3").unwrap();
    dir
}

#[tokio::test]
async fn app_routes_are_found_and_other_paths_are_404() {
    let dir = web_dir();
    let addr = serve_web(AppState::new(Duration::ZERO), Some(dir.path().to_path_buf())).await;

    for path in [
        "/",
        "/r/abc234",
        "/rules/gshs",
        "/about",
        "/privacy",
        "/preview",
        "/deck",
        "/share",
    ] {
        let r = get(addr, path).await;
        assert_eq!(r.status, 200, "{path}");
        assert!(r.body.contains("<div id=\"app\">"), "{path} serves the app");
        assert!(r.head.contains("cache-control: no-cache"), "{path}");
        assert!(r.head.contains("x-content-type-options: nosniff"));
    }
    // Unknown app paths get the app (to show its not-found page) with a 404.
    for path in ["/nope", "/rules/nowhere", "/wp-login.php", "/r/a/b"] {
        let r = get(addr, path).await;
        assert_eq!(r.status, 404, "{path}");
        assert!(r.body.contains("<div id=\"app\">"), "{path}");
        assert!(r.body.contains("noindex"));
    }
    // API paths and missing build files are plain 404s.
    for path in [
        "/api/nope",
        "/api/rooms/zzzzzz",
        "/internal/nope",
        "/assets/gone-12345678.js",
    ] {
        let r = get(addr, path).await;
        assert_eq!(r.status, 404, "{path}");
        assert!(!r.body.contains("<div id=\"app\">"), "{path}");
    }
    // Built files are served as they are.
    let asset = get(addr, "/assets/index-abc12345.js").await;
    assert_eq!((asset.status, asset.body.as_str()), (200, "console.log(1)"));
    assert_eq!(get(addr, "/og.png").await.status, 200);
    assert_eq!(get(addr, "/music/a.mp3").await.status, 200);
    assert_eq!(get(addr, "/music/").await.status, 404);

    let rules = get(addr, "/rules/kmla").await;
    assert!(rules.body.contains("<title>민사고 마이티 규칙 · 마이티</title>"));
    assert!(rules.body.contains("https://cards.buttercrab.io/rules/kmla"));
    assert!(!rules.body.contains("cloudflareinsights"), "no beacon without a token");
}

#[tokio::test]
async fn a_share_link_preview_names_the_rules_and_empty_seats() {
    let dir = web_dir();
    let state = AppState::new(Duration::ZERO).with_beacon("tok123".into());
    let addr = serve_web(state, Some(dir.path().to_path_buf())).await;
    let r = request(
        addr,
        "POST",
        "/api/rooms",
        &[],
        &json!({ "preset": "gshs" }).to_string(),
    )
    .await;
    let id = serde_json::from_str::<Value>(&r.body).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    let page = get(addr, &format!("/r/{id}")).await;
    assert_eq!(page.status, 200);
    assert!(
        page.body
            .contains(r#"<meta property="og:title" content="마이티 한 판 하실래요? · 경기과고 규칙 · 빈 자리 5" />"#),
        "{}",
        page.body
    );
    assert!(page.body.contains(r#"data-cf-beacon='{"token":"tok123"}'"#));
    // A closed table still gets the app, described plainly.
    let gone = get(addr, "/r/zzzzzz").await;
    assert_eq!(gone.status, 200);
    assert!(gone.body.contains("<title>마이티 한 판 하실래요?</title>"));
}

#[tokio::test]
async fn robots_and_sitemap_are_served() {
    let addr = serve(AppState::new(Duration::ZERO)).await;
    let robots = get(addr, "/robots.txt").await;
    assert_eq!(robots.status, 200);
    assert!(robots.body.contains("Disallow: /api/"));
    assert!(robots.body.contains("Sitemap: https://cards.buttercrab.io/sitemap.xml"));
    let sitemap = get(addr, "/sitemap.xml").await;
    assert_eq!(sitemap.status, 200);
    assert!(sitemap.head.contains("application/xml"));
    assert!(
        sitemap
            .body
            .contains("<loc>https://cards.buttercrab.io/rules/gshs</loc>")
    );
}

#[tokio::test]
async fn the_stats_page_is_private() {
    let off = serve(AppState::new(Duration::ZERO)).await;
    assert_eq!(get(off, "/stats").await.status, 404, "no token, no page");
    assert_eq!(get(off, "/api/stats").await.status, 404);

    let addr = serve(AppState::new(Duration::ZERO).with_stats_token("s3cret".into())).await;
    assert_eq!(get(addr, "/stats").await.status, 401);
    assert_eq!(get(addr, "/stats?token=wrong").await.status, 401);
    let login = get(addr, "/stats?token=s3cret").await;
    assert_eq!(login.status, 303);
    assert!(login.head.contains("location: /stats\r\n"));
    let cookie = login
        .head
        .lines()
        .find_map(|l| l.strip_prefix("set-cookie: "))
        .expect("a cookie")
        .to_string();
    assert!(
        cookie.contains("httponly") && cookie.contains("samesite=strict"),
        "{cookie}"
    );
    let pair = cookie.split(';').next().unwrap();
    let page = request(addr, "GET", "/stats", &[&format!("Cookie: {pair}")], "").await;
    assert_eq!(page.status, 200);
    assert!(page.body.contains("마이티 통계"));
    assert!(page.head.contains("cache-control: no-store"));
    let api = request(addr, "GET", "/api/stats", &["Authorization: Bearer s3cret"], "").await;
    assert_eq!(api.status, 200);
    let summary: Value = serde_json::from_str(&api.body).unwrap();
    assert_eq!(summary["days"].as_array().unwrap().len(), 30);
}

#[tokio::test]
async fn tables_and_hands_are_counted() {
    let state = AppState::new(Duration::ZERO);
    let stats = state.stats();
    let addr = serve(state).await;
    let r = request(
        addr,
        "POST",
        "/api/rooms",
        &[],
        &json!({ "preset": "kmla" }).to_string(),
    )
    .await;
    assert_eq!(r.status, 200);
    let s = stats.summary(server::stats::now());
    assert_eq!(s.totals.tables, 1);
    // Seats, hands and their ends are counted by the room; see rooms.rs for
    // a full hand. Here: a report counts too.
    let r = request(addr, "POST", "/api/reports", &[], &json!({ "text": "hm" }).to_string()).await;
    assert_eq!(r.status, 204);
    assert_eq!(stats.summary(server::stats::now()).totals.reports, 1);
}

#[tokio::test]
async fn a_new_client_error_is_saved_for_an_issue_once() {
    let data = temp_dir();
    let data = data.path();
    let state = AppState::new(Duration::ZERO).with_data(data.to_path_buf());
    let stats = state.stats();
    let addr = serve(state).await;
    let error = |n: u32| {
        json!({
            "message": format!("seat {n} is undefined"),
            "stack": format!("TypeError\n    at Kt (https://cards.buttercrab.io/assets/index-AAAA{n:04}.js:1:{n})"),
            "url": "https://cards.buttercrab.io/r/abc234",
            "ua": "test",
            "version": "abc",
            "extra": "ignored",
        })
        .to_string()
    };
    for n in 0..3 {
        let r = request(addr, "POST", "/api/errors", &[], &error(n)).await;
        assert_eq!(r.status, 204, "{}", r.body);
    }
    let other = json!({ "message": "something else" }).to_string();
    assert_eq!(request(addr, "POST", "/api/errors", &[], &other).await.status, 204);
    assert_eq!(request(addr, "POST", "/api/errors", &[], "{}").await.status, 422);
    let huge = json!({ "message": "x".repeat(40_000) }).to_string();
    assert_eq!(request(addr, "POST", "/api/errors", &[], &huge).await.status, 413);

    let files: Vec<_> = std::fs::read_dir(data.join("errors")).unwrap().flatten().collect();
    assert_eq!(files.len(), 2, "one file per new group");
    let s = stats.summary(server::stats::now());
    assert_eq!(s.totals.client_errors, 4);
    assert_eq!(s.errors.len(), 2);
    let seat = s.errors.iter().find(|e| e.message.starts_with("seat")).unwrap();
    assert_eq!(seat.count, 3);
    assert_eq!(seat.message, "seat # is undefined");
    assert_eq!(seat.frame, "Kt@index.js");
    let log = std::fs::read_to_string(data.join("stats.jsonl")).unwrap();
    assert!(!log.contains("127.0.0.1"), "no addresses in the log");
}

#[tokio::test]
async fn too_many_requests_from_one_client_are_refused() {
    let addr = serve(AppState::new(Duration::ZERO)).await;
    let body = json!({ "preset": "gshs" }).to_string();
    let from = |ip: &'static str| [ip];
    for _ in 0..10 {
        let r = request(
            addr,
            "POST",
            "/api/rooms",
            &from("X-Forwarded-For: 198.51.100.7"),
            &body,
        )
        .await;
        assert_eq!(r.status, 200);
    }
    let r = request(
        addr,
        "POST",
        "/api/rooms",
        &from("X-Forwarded-For: 198.51.100.7"),
        &body,
    )
    .await;
    assert_eq!(r.status, 429);
    assert!(r.body.contains("잠시 후에"));
    let r = request(
        addr,
        "POST",
        "/api/rooms",
        &from("X-Forwarded-For: 198.51.100.8"),
        &body,
    )
    .await;
    assert_eq!(r.status, 200, "another client is not held back");

    let report = json!({ "text": "hm" }).to_string();
    let codes: Vec<u16> = futures_util::future::join_all(
        (0..6).map(|_| request(addr, "POST", "/api/reports", &["X-Forwarded-For: 203.0.113.1"], &report)),
    )
    .await
    .into_iter()
    .map(|r| r.status)
    .collect();
    assert_eq!(codes.iter().filter(|&&c| c == 429).count(), 1, "{codes:?}");
}
