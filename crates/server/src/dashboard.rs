//! The owner's stats page, `GET /stats`, and its data, `GET /api/stats`.
//! The page also lists players' problem reports, each saved report readable
//! in full at `GET /stats/reports/<file>`.
//! Both need `STATS_TOKEN`: as `?token=` once, which leaves a cookie for
//! this page only, or as `Authorization: Bearer`. Without the variable set,
//! neither exists.

use crate::AppState;
use crate::site::escape;
use crate::stats::{Summary, date, day, hex, now};
use axum::extract::{Path, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use sha2::{Digest, Sha256};
use std::fmt::Write;

const COOKIE: &str = "mighty_stats";

/// The cookie's value: derived from the token, so the token itself is not
/// sent with every request.
fn cookie_value(token: &str) -> String {
    hex(&Sha256::digest(format!("mighty-stats-cookie\0{token}").as_bytes()))
}

enum Access {
    /// No `STATS_TOKEN`: the page does not exist.
    Off,
    Denied,
    /// The token came in the query; set the cookie and drop it from the URL.
    Remember(String),
    Granted,
}

fn access(token: Option<&str>, uri: &Uri, headers: &HeaderMap) -> Access {
    let Some(token) = token else { return Access::Off };
    let eq = |given: &str| crate::constant_time_eq(token.as_bytes(), given.as_bytes());
    let bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    if bearer.is_some_and(eq) {
        return Access::Granted;
    }
    let expected = cookie_value(token);
    let cookie = headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|c| c.trim().strip_prefix(COOKIE)?.strip_prefix('='))
        .any(|v| crate::constant_time_eq(v.as_bytes(), expected.as_bytes()));
    if cookie {
        return Access::Granted;
    }
    let query = uri
        .query()
        .into_iter()
        .flat_map(|q| q.split('&'))
        .find_map(|kv| kv.strip_prefix("token="));
    match query {
        Some(given) if eq(given) => Access::Remember(expected),
        _ => Access::Denied,
    }
}

/// Checks access; on success returns `None` and the caller answers.
fn gate(app: &AppState, uri: &Uri, headers: &HeaderMap) -> Option<Response> {
    match access(app.stats_token.as_deref(), uri, headers) {
        Access::Off => Some(StatusCode::NOT_FOUND.into_response()),
        Access::Denied => Some((StatusCode::UNAUTHORIZED, "통계를 보려면 토큰이 필요해요.").into_response()),
        Access::Remember(value) => {
            let secure = headers
                .get("x-forwarded-proto")
                .is_some_and(|p| p.as_bytes() == b"https");
            let cookie = format!(
                "{COOKIE}={value}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict{}",
                if secure { "; Secure" } else { "" }
            );
            let mut response = (StatusCode::SEE_OTHER, [(header::LOCATION, uri.path().to_string())]).into_response();
            if let Ok(cookie) = HeaderValue::from_str(&cookie) {
                response.headers_mut().insert(header::SET_COOKIE, cookie);
            }
            Some(private(response))
        }
        Access::Granted => None,
    }
}

/// Kept out of caches and search results.
fn private(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert("x-robots-tag", HeaderValue::from_static("noindex"));
    response
}

pub async fn stats_json(State(app): State<AppState>, uri: Uri, headers: HeaderMap) -> Response {
    if let Some(denied) = gate(&app, &uri, &headers) {
        return denied;
    }
    let mut body = serde_json::to_value(app.stats.summary(now())).unwrap_or_default();
    if let Ok(server) = serde_json::to_value(app.server_status()) {
        body["server"] = server;
    }
    private(axum::Json(body).into_response())
}

/// What the server is doing right now, beside the logged stats.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ServerStatus {
    pub rooms: usize,
    pub max_rooms: usize,
    pub worker: crate::bots::WorkerStatus,
}

/// The server section: open tables and the bot worker's link.
fn server_section(s: &ServerStatus) -> String {
    let w = &s.worker;
    let link = match (w.expected, w.connected) {
        (_, true) => "연결됨".to_string(),
        (true, false) => "<b class=\"warn\">끊김: 봇이 이 서버에서 생각해요</b>".to_string(),
        (false, false) => "쓰지 않음".to_string(),
    };
    let mut out = String::from("<section><h2>서버</h2><table>");
    rows(
        &mut out,
        [
            ("열린 테이블".to_string(), format!("{} / {}", s.rooms, s.max_rooms)),
            ("봇 워커".to_string(), link),
            ("연결한 때".to_string(), w.since.map(time).unwrap_or_else(|| "–".into())),
            (
                "마지막 응답".to_string(),
                w.last_seen.map(time).unwrap_or_else(|| "–".into()),
            ),
            ("워커가 둔 수".to_string(), w.answered.to_string()),
            ("워커가 못 둔 수".to_string(), w.failed.to_string()),
            ("서버가 대신 둔 수".to_string(), w.fallbacks.to_string()),
            ("서버 빌드".to_string(), escape(&short(&w.server_commit))),
            ("워커 빌드".to_string(), worker_build(w)),
        ],
    );
    if let Some(r) = &w.refused {
        let _ = write!(
            out,
            "<tr><th>거절한 워커</th><td><b class=\"warn\">{} · 프로토콜 {} (서버 {}) · {}</b></td></tr>",
            time(r.at),
            r.protocol,
            w.protocol,
            escape(&r.reason),
        );
    }
    out.push_str("</table><p class=\"note\">서버가 시작한 뒤로 센 값이에요.</p></section>");
    out
}

/// A commit, shortened to twelve characters as the deploy tags images.
fn short(commit: &str) -> String {
    commit.chars().take(12).collect()
}

/// The connected worker's build, flagged when it is not the server's.
fn worker_build(w: &crate::bots::WorkerStatus) -> String {
    match &w.commit {
        None => "–".into(),
        Some(c) if *c == w.server_commit => escape(&short(c)),
        Some(c) => format!("<b class=\"warn\">{} (서버와 다름)</b>", escape(&short(c))),
    }
}

pub async fn stats_page(State(app): State<AppState>, uri: Uri, headers: HeaderMap) -> Response {
    if let Some(denied) = gate(&app, &uri, &headers) {
        return denied;
    }
    let reports = app
        .data
        .as_deref()
        .map(|dir| recent_reports(&dir.join("reports")))
        .unwrap_or_default();
    let html = page_full(&app.stats.summary(now()), &reports, Some(&app.server_status()));
    private(([(header::CONTENT_TYPE, "text/html; charset=utf-8")], html).into_response())
}

/// One saved report, as the page lists it.
pub struct ReportRow {
    pub file: String,
    pub time: u64,
    pub text: String,
    pub room_id: Option<String>,
}

/// A report's file name: the time it arrived, then six hex digits.
fn report_name(name: &str) -> Option<u64> {
    let (time, rest) = name.strip_suffix(".json")?.split_once('-')?;
    (rest.len() == 6 && rest.bytes().all(|b| b.is_ascii_hexdigit())).then_some(())?;
    time.parse().ok()
}

/// The newest saved reports first, at most 50.
pub fn recent_reports(dir: &std::path::Path) -> Vec<ReportRow> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut rows: Vec<ReportRow> = entries
        .flatten()
        .filter_map(|e| {
            let file = e.file_name().into_string().ok()?;
            let time = report_name(&file)?;
            let json: serde_json::Value = serde_json::from_slice(&std::fs::read(e.path()).ok()?).ok()?;
            Some(ReportRow {
                file,
                time,
                text: json["text"].as_str().unwrap_or_default().to_string(),
                room_id: json["room_id"].as_str().map(str::to_string),
            })
        })
        .collect();
    rows.sort_by(|a, b| b.time.cmp(&a.time).then_with(|| b.file.cmp(&a.file)));
    rows.truncate(50);
    rows
}

/// One saved report in full, for replaying the hand it came from.
pub async fn report_file(
    State(app): State<AppState>,
    Path(file): Path<String>,
    uri: Uri,
    headers: HeaderMap,
) -> Response {
    if let Some(denied) = gate(&app, &uri, &headers) {
        return denied;
    }
    // Only names the server itself writes, so no path can leave the folder.
    let (Some(dir), Some(_)) = (app.data.as_deref(), report_name(&file)) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match std::fs::read(dir.join("reports").join(&file)) {
        Ok(body) => private(([(header::CONTENT_TYPE, "application/json")], body).into_response()),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

/// `t` in Korean time, to the minute.
fn time(t: u64) -> String {
    let minutes = ((t + 9 * 3600) % 86_400) / 60;
    format!("{} {:02}:{:02}", date(day(t)), minutes / 60, minutes % 60)
}

/// A bot level as the stats record it, by its name at the table.
fn level_name(level: &str) -> String {
    level
        .parse::<mighty::bot::Level>()
        .map_or_else(|_| level.to_string(), |l| l.label().to_string())
}

fn preset_label(id: &str) -> String {
    match id.parse() {
        Ok(preset) => format!(
            "{} <span class=\"muted\">{id}</span>",
            mighty::rules::Preset::title(preset)
        ),
        Err(_) => escape(id),
    }
}

fn percent(part: u32, whole: u32) -> String {
    if whole == 0 {
        "–".into()
    } else {
        format!("{:.0}%", f64::from(part) * 100.0 / f64::from(whole))
    }
}

/// Tables and finished hands a day, as paired bars.
fn bars(s: &Summary) -> String {
    let (w, h, top) = (600.0, 140.0, 12.0);
    let max = s
        .days
        .iter()
        .map(|d| d.tables.max(d.hands_finished))
        .max()
        .unwrap_or(0)
        .max(1);
    let slot = w / s.days.len().max(1) as f64;
    let bar = (slot - 4.0) / 2.0;
    let mut svg = format!(
        "<svg viewBox=\"0 0 {w} {}\" role=\"img\" aria-label=\"하루 테이블과 끝난 판\">",
        h + 18.0
    );
    let _ = write!(
        svg,
        "<line x1=\"0\" y1=\"{h}\" x2=\"{w}\" y2=\"{h}\" class=\"axis\"/><text x=\"0\" y=\"{}\" class=\"tick\">최대 {max}</text>",
        top - 2.0
    );
    for (i, d) in s.days.iter().enumerate() {
        let x = i as f64 * slot + 2.0;
        for (j, (value, class)) in [(d.tables, "t"), (d.hands_finished, "h")].into_iter().enumerate() {
            let height = f64::from(value) / f64::from(max) * (h - top - 4.0);
            let _ = write!(
                svg,
                "<rect x=\"{:.1}\" y=\"{:.1}\" width=\"{bar:.1}\" height=\"{height:.1}\" class=\"{class}\"><title>{} {}: {value}</title></rect>",
                x + j as f64 * bar,
                h - height,
                d.date,
                if class == "t" { "테이블" } else { "끝난 판" },
            );
        }
    }
    if let (Some(first), Some(last)) = (s.days.first(), s.days.last()) {
        let _ = write!(
            svg,
            "<text x=\"0\" y=\"{y}\" class=\"tick\">{}</text><text x=\"{w}\" y=\"{y}\" class=\"tick end\">{}</text>",
            &first.date[5..],
            &last.date[5..],
            y = h + 15.0
        );
    }
    svg.push_str("</svg>");
    svg
}

fn rows<'a>(out: &mut String, items: impl IntoIterator<Item = (String, String)> + 'a) {
    let mut any = false;
    for (k, v) in items {
        any = true;
        let _ = write!(out, "<tr><th>{k}</th><td>{v}</td></tr>");
    }
    if !any {
        out.push_str("<tr><td colspan=\"2\" class=\"muted\">아직 없어요</td></tr>");
    }
}

pub fn page(s: &Summary) -> String {
    page_with(s, &[])
}

pub fn page_with(s: &Summary, reports: &[ReportRow]) -> String {
    page_full(s, reports, None)
}

/// The whole page, with the server's live state on top when given.
pub fn page_full(s: &Summary, reports: &[ReportRow], server: Option<&ServerStatus>) -> String {
    let t = &s.totals;
    let mut body = String::new();
    let _ = write!(
        body,
        "<header><h1>마이티 통계</h1><p class=\"muted\">최근 30일 · 한국 시간 · {} 기준</p></header>",
        time(s.generated)
    );
    if let Some(server) = server {
        body.push_str(&server_section(server));
    }

    body.push_str("<section class=\"tiles\">");
    for (label, value) in [
        ("테이블", t.tables.to_string()),
        ("끝난 판", t.hands_finished.to_string()),
        ("중단된 판", t.hands_abandoned.to_string()),
        ("시간 초과", t.turns_timed_out.to_string()),
        ("판 중간에 나감", t.left_mid_hand.to_string()),
        ("문제 신고", t.reports.to_string()),
        ("클라이언트 오류", t.client_errors.to_string()),
    ] {
        let _ = write!(body, "<div class=\"tile\"><b>{value}</b><span>{label}</span></div>");
    }
    body.push_str("</section>");

    body.push_str("<section><h2>하루 테이블과 판</h2>");
    body.push_str("<p class=\"legend\"><i class=\"t\"></i>테이블 <i class=\"h\"></i>끝난 판</p>");
    body.push_str(&bars(s));
    body.push_str("<details><summary>날짜별 숫자</summary><table class=\"num\"><tr><th>날짜</th><th>테이블</th><th>시작</th><th>끝</th><th>중단</th></tr>");
    for d in s.days.iter().rev() {
        let _ = write!(
            body,
            "<tr><th>{}</th><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>",
            d.date, d.tables, d.hands_started, d.hands_finished, d.hands_abandoned
        );
    }
    body.push_str("</table></details></section>");

    body.push_str("<div class=\"grid\">");
    body.push_str("<section><h2>판</h2><table>");
    let ended = t.hands_finished + t.hands_abandoned;
    let mut items = vec![
        (
            "끝까지 친 판".to_string(),
            format!("{} ({})", t.hands_finished, percent(t.hands_finished, ended)),
        ),
        (
            "중간에 끝난 판".to_string(),
            format!("{} ({})", t.hands_abandoned, percent(t.hands_abandoned, ended)),
        ),
    ];
    for (outcome, n) in &s.outcomes {
        let name = match outcome.as_str() {
            "made" => "공약 성공".to_string(),
            "failed" => "공약 실패".to_string(),
            other => escape(other),
        };
        items.push((name, format!("{n} ({})", percent(*n, t.hands_finished))));
    }
    if let Some(secs) = s.median_hand_secs {
        items.push(("한 판 길이 (중앙값)".into(), format!("{}분 {}초", secs / 60, secs % 60)));
    }
    rows(&mut body, items);
    body.push_str("</table></section>");

    body.push_str("<section><h2>플레이어</h2><table>");
    let p = &s.players;
    rows(
        &mut body,
        [
            ("7일 동안 친 사람".to_string(), p.active_7.to_string()),
            (
                "그중 다시 온 사람".into(),
                format!("{} ({})", p.returning_7, percent(p.returning_7, p.active_7)),
            ),
            ("30일 동안 친 사람".into(), p.active_30.to_string()),
            (
                "그중 다시 온 사람".into(),
                format!("{} ({})", p.returning_30, percent(p.returning_30, p.active_30)),
            ),
        ],
    );
    body.push_str(
        "</table><p class=\"note\">브라우저마다 무작위로 만든 기기 번호를 소금 친 해시로만 셉니다. 기기 번호가 없는 옛 접속은 테이블 자리 토큰으로 셉니다.</p></section>",
    );

    body.push_str("<section><h2>사람과 봇</h2><table>");
    rows(
        &mut body,
        s.hands_by_humans
            .iter()
            .map(|(humans, n)| (format!("사람 {humans}명인 판"), n.to_string())),
    );
    body.push_str("</table><table>");
    rows(
        &mut body,
        s.tables_by_humans
            .iter()
            .map(|(humans, n)| (format!("사람이 최대 {humans}명 앉은 테이블"), n.to_string())),
    );
    body.push_str("</table><table>");
    rows(
        &mut body,
        s.bots_by_level
            .iter()
            .map(|(level, n)| (format!("{} 봇을 앉힌 횟수", level_name(level)), n.to_string())),
    );
    body.push_str("</table></section>");

    body.push_str("<section><h2>규칙</h2><table>");
    rows(
        &mut body,
        s.presets.iter().map(|p| {
            let custom = if p.custom > 0 {
                format!(" <span class=\"muted\">(바꾼 규칙 {})</span>", p.custom)
            } else {
                String::new()
            };
            (preset_label(&p.preset), format!("{}판{custom}", p.hands))
        }),
    );
    body.push_str("</table></section></div>");

    body.push_str("<section><h2>문제 신고</h2>");
    if reports.is_empty() {
        body.push_str("<p class=\"muted\">서버에 남은 신고가 없어요. 신고는 14일 동안 둬요.</p>");
    } else {
        body.push_str(
            "<div class=\"scroll\"><table class=\"errors\"><tr><th>내용</th><th>테이블</th><th>받은 때</th></tr>",
        );
        for r in reports {
            let text = if r.text.is_empty() {
                "(내용 없음)".to_string()
            } else {
                escape(&r.text)
            };
            let _ = write!(
                body,
                "<tr><td>{text}<br><a href=\"/stats/reports/{}\">전체 기록</a></td><td>{}</td><td class=\"when\">{}</td></tr>",
                escape(&r.file),
                r.room_id.as_deref().map(escape).unwrap_or_else(|| "–".into()),
                time(r.time)
            );
        }
        body.push_str("</table></div>");
    }
    body.push_str("</section>");

    body.push_str("<section><h2>클라이언트 오류</h2>");
    if s.errors.is_empty() {
        body.push_str("<p class=\"muted\">최근 30일 동안 없어요.</p>");
    } else {
        body.push_str(
            "<div class=\"scroll\"><table class=\"errors\"><tr><th>메시지</th><th>횟수</th><th>마지막</th></tr>",
        );
        for e in &s.errors {
            let frame = if e.frame.is_empty() {
                String::new()
            } else {
                format!("<br><code>{}</code>", escape(&e.frame))
            };
            let version = e
                .version
                .as_deref()
                .map(|v| format!("<br><span class=\"muted\">v{}</span>", escape(v)))
                .unwrap_or_default();
            let _ = write!(
                body,
                "<tr><td>{}{frame}</td><td class=\"n\">{}</td><td class=\"when\">{}{version}</td></tr>",
                escape(&e.message),
                e.count,
                time(e.last_seen)
            );
        }
        body.push_str("</table></div>");
    }
    body.push_str("</section>");

    format!(
        "<!doctype html>\n<html lang=\"ko\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><meta name=\"color-scheme\" content=\"light dark\"><meta name=\"robots\" content=\"noindex\"><link rel=\"icon\" href=\"/favicon.svg\" type=\"image/svg+xml\"><title>통계 · 마이티</title><style>{STYLE}</style></head><body><main>{body}</main></body></html>\n"
    )
}

const STYLE: &str = r#"
:root{--bg:#EFEBE3;--panel:#E6E1D6;--line:#D6CFC1;--ink:#1C1915;--muted:#645D53;--accent:#8E2F6B;--soft:#B9AE9C}
@media (prefers-color-scheme:dark){:root{--bg:#17191C;--panel:#202327;--line:#2F343A;--ink:#ECE7DD;--muted:#9A958B;--accent:#D27BB0;--soft:#5A5650}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Noto Sans KR',system-ui,sans-serif;font-variant-numeric:tabular-nums}
main{max-width:920px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:24px;margin:0;font-weight:800}
h2{font-size:15px;margin:0 0 10px;font-weight:700}
a{color:inherit;text-underline-offset:2px}
header p{margin:2px 0 20px}
section{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;margin:0 0 12px;min-width:0}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;background:none;border:0;padding:0}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.tile b{display:block;font-size:26px;font-weight:800;line-height:1.2}
.tile span{color:var(--muted);font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-bottom:12px}
.grid section{margin:0}
svg{display:block;width:100%;height:auto}
rect.t{fill:var(--soft)}rect.h{fill:var(--accent)}
.axis{stroke:var(--line)}
.tick{fill:var(--muted);font-size:11px}.tick.end{text-anchor:end}
.legend{margin:0 0 6px;font-size:13px;color:var(--muted)}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px 0 10px;vertical-align:-1px}
.legend i:first-child{margin-left:0}
.legend i.t{background:var(--soft)}.legend i.h{background:var(--accent)}
table{width:100%;border-collapse:collapse;margin:0 0 8px}
th,td{text-align:left;padding:6px 0;border-bottom:1px solid var(--line);vertical-align:top}
th{font-weight:500}
td{text-align:right}
tr:last-child th,tr:last-child td{border-bottom:0}
.num th,.num td{text-align:right;padding-left:8px}.num tr>:first-child{text-align:left;padding-left:0}
.errors td{text-align:left;padding-right:12px;word-break:break-word}
.errors td.n{text-align:right}
.errors th{white-space:nowrap}
.errors td.when{white-space:nowrap;padding-right:0;font-size:13px}
.scroll{overflow-x:auto}
code{font-size:12px;color:var(--muted)}
details{margin-top:8px}
summary{cursor:pointer;color:var(--accent);font-weight:600}
.muted,.note{color:var(--muted)}
.note{font-size:13px;margin:4px 0 0}
.warn{color:var(--accent)}
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stats::{Event, Hand, Stats};

    #[test]
    fn bot_levels_go_by_their_names_at_the_table() {
        assert_eq!(level_name("hard"), "고수");
        assert_eq!(level_name("easy"), "초보");
        assert_eq!(level_name("legendary"), "legendary");
    }

    fn get(uri: &str, headers: &[(&'static str, &str)]) -> (Uri, HeaderMap) {
        let mut map = HeaderMap::new();
        for (k, v) in headers {
            map.append(*k, HeaderValue::from_str(v).unwrap());
        }
        (uri.parse().unwrap(), map)
    }

    #[test]
    fn the_page_needs_the_token_and_remembers_it_in_a_cookie() {
        let (uri, h) = get("/stats", &[]);
        assert!(matches!(access(None, &uri, &h), Access::Off));
        assert!(matches!(access(Some("s3cret"), &uri, &h), Access::Denied));
        let (uri, h) = get("/stats?token=wrong", &[]);
        assert!(matches!(access(Some("s3cret"), &uri, &h), Access::Denied));
        let (uri, h) = get("/stats?token=s3cret", &[]);
        let Access::Remember(value) = access(Some("s3cret"), &uri, &h) else {
            panic!("the right token is remembered");
        };
        assert!(!value.contains("s3cret"));
        let cookie = format!("other=1; {COOKIE}={value}");
        let (uri, h) = get("/stats", &[("cookie", &cookie)]);
        assert!(matches!(access(Some("s3cret"), &uri, &h), Access::Granted));
        let (uri, h) = get("/stats", &[("cookie", &format!("{COOKIE}=nope"))]);
        assert!(matches!(access(Some("s3cret"), &uri, &h), Access::Denied));
        let (uri, h) = get("/api/stats", &[("authorization", "Bearer s3cret")]);
        assert!(matches!(access(Some("s3cret"), &uri, &h), Access::Granted));
    }

    #[test]
    fn the_page_renders_the_summary_and_escapes_client_text() {
        let stats = Stats::in_memory();
        stats.record(Event::HandFinished {
            hand: Hand {
                table: "a".into(),
                preset: "gshs".into(),
                custom: false,
                humans: 2,
                bots: 3,
            },
            outcome: "made".into(),
            secs: Some(125),
        });
        stats.record(Event::ClientError {
            group: "g".into(),
            message: "<script>alert(1)</script>".into(),
            frame: "f@index.js".into(),
            version: Some("1".into()),
        });
        let html = page(&stats.summary(now()));
        assert!(html.contains("마이티 통계"));
        assert!(html.contains("경기과고"));
        assert!(html.contains("2분 5초"));
        assert!(html.contains("&lt;script&gt;alert"));
        assert!(!html.contains("<script>"), "no scripts at all");
        assert!(!html.contains("http"), "no external assets");
        assert!(html.contains("prefers-color-scheme:dark"));
    }

    #[test]
    fn the_page_warns_when_the_expected_bot_worker_is_away() {
        let server = ServerStatus {
            rooms: 3,
            max_rooms: 500,
            worker: crate::bots::WorkerStatus {
                expected: true,
                connected: false,
                since: None,
                last_seen: Some(1_791_105_000),
                answered: 12,
                failed: 2,
                fallbacks: 4,
                protocol: crate::bots::PROTOCOL,
                server_commit: "0123456789abcdef".into(),
                commit: None,
                refused: Some(crate::bots::Refusal {
                    at: 1_791_104_000,
                    protocol: 1,
                    commit: None,
                    reason: "sent no hello (an older worker)".into(),
                }),
            },
        };
        let summary = crate::stats::Stats::in_memory().summary(1_791_105_000);
        let html = page_full(&summary, &[], Some(&server));
        assert!(html.contains("3 / 500"));
        assert!(html.contains("끊김"));
        assert!(html.contains("거절한 워커") && html.contains("an older worker"));
        assert!(html.contains("0123456789ab"));
        assert!(!page(&summary).contains("봇 워커"), "only with the server's state");
    }

    #[test]
    fn report_names_are_only_the_servers_own() {
        assert_eq!(report_name("1791105000-0a1b2c.json"), Some(1_791_105_000));
        for bad in [
            "../secret.json",
            "1791105000-0a1b2c.json/..",
            "x-0a1b2c.json",
            "1791105000-0a1b2.json",
            "1791105000-0a1b2c.txt",
        ] {
            assert_eq!(report_name(bad), None, "{bad}");
        }
    }

    #[test]
    fn the_page_lists_reports_newest_first_and_escapes_them() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        std::fs::write(dir.join("100-000001.json"), r#"{"text":"첫 신고","room_id":"abc"}"#).unwrap();
        std::fs::write(dir.join("200-000002.json"), r#"{"text":"<b>둘째</b>","room_id":null}"#).unwrap();
        std::fs::write(dir.join("notes.txt"), "ignored").unwrap();
        let rows = recent_reports(dir);
        assert_eq!(rows.iter().map(|r| r.time).collect::<Vec<_>>(), [200, 100]);
        let html = page_with(&crate::stats::Stats::in_memory().summary(1_791_105_000), &rows);
        assert!(html.contains("&lt;b&gt;둘째&lt;/b&gt;") && html.contains("/stats/reports/100-000001.json"));
    }
}
