//! The web client's pages as crawlers and link previews see them: the
//! built `index.html` with a title, description and Open Graph tags for the
//! page asked for, the right status for paths the app does not have, and
//! `robots.txt` and `sitemap.xml`.

use crate::AppState;
use crate::room::Command;
use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use mighty::rules::Preset;
use serde_json::Value;
use std::time::Duration;
use tower::ServiceExt;
use tower_http::services::ServeDir;

/// Where the site lives, for canonical links and the sitemap.
pub const SITE_URL: &str = "https://cards.buttercrab.io";

pub fn robots(site: &str) -> String {
    format!(
        "User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /internal/\nDisallow: /stats\nDisallow: /r/\n\nSitemap: {site}/sitemap.xml\n"
    )
}

pub fn sitemap(site: &str) -> String {
    let mut paths = vec!["/".to_string(), "/about".into(), "/privacy".into()];
    paths.extend(Preset::ALL.iter().map(|p| format!("/rules/{}", p.name())));
    let mut xml = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n",
    );
    for path in paths {
        xml.push_str(&format!(
            "  <url><loc>{}</loc></url>\n",
            escape(&format!("{site}{path}"))
        ));
    }
    xml.push_str("</urlset>\n");
    xml
}

/// What the page at a path is, as far as the server can tell.
#[derive(Debug, PartialEq, Eq)]
pub enum Page {
    Home,
    Room(String),
    Rules(Preset),
    About,
    Privacy,
    /// The app's own tools (`/deck`, `/preview`, `/share`): served, not described.
    Tool,
    /// Not an app route: the app shows its not-found page, with status 404.
    NotFound,
}

impl Page {
    /// The page at `path`, matching the routes `web/src/App.svelte` knows.
    pub fn at(path: &str) -> Page {
        let one = |prefix: &str| {
            let rest = path.strip_prefix(prefix)?;
            let id = rest.strip_suffix('/').unwrap_or(rest);
            (!id.is_empty() && !id.contains('/')).then_some(id)
        };
        match path {
            "/" | "/index.html" => return Page::Home,
            "/about" => return Page::About,
            "/privacy" => return Page::Privacy,
            "/deck" | "/preview" | "/share" => return Page::Tool,
            _ => {}
        }
        if let Some(id) = one("/r/")
            && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        {
            return Page::Room(id.to_string());
        }
        // A rulebook for a preset the server does not know is not a page.
        if let Some(preset) = one("/rules/").and_then(|id| id.parse().ok()) {
            return Page::Rules(preset);
        }
        Page::NotFound
    }
}

/// A table as its share link's preview describes it.
#[derive(Debug, Clone, PartialEq)]
pub struct TableInfo {
    pub preset: Option<Preset>,
    pub custom: bool,
    pub empty: usize,
}

/// The head tags a page gets.
#[derive(Debug, PartialEq)]
pub struct Meta {
    pub title: String,
    pub description: String,
    /// Canonical path, if the page should have one.
    pub path: Option<String>,
    pub noindex: bool,
}

const DESCRIPTION: &str = "친구들과 마이티 한 판. 링크 하나로 모여 앉고, 빈 자리는 봇이 채워요.";
const SHARE_DESCRIPTION: &str = "링크를 누르면 바로 테이블에 앉아요. 빈 자리는 봇이 채워요.";

pub fn meta(page: &Page, path: &str, table: Option<&TableInfo>) -> Meta {
    let plain = |title: &str, description: &str, canonical: &str| Meta {
        title: title.to_string(),
        description: description.to_string(),
        path: Some(canonical.to_string()),
        noindex: false,
    };
    match page {
        Page::Home => plain("마이티", DESCRIPTION, "/"),
        Page::About => plain(
            "마이티 소개 · 마이티",
            "링크 하나로 친구들과 치는 마이티. 학교마다 다른 규칙을 고르고, 빈 자리는 봇이 채워요.",
            "/about",
        ),
        Page::Privacy => plain(
            "개인정보 처리방침 · 마이티",
            "마이티가 모으는 것과 모으지 않는 것: 계정도 쿠키도 없이, 판의 기록은 기기에만 남아요.",
            "/privacy",
        ),
        Page::Rules(preset) => {
            let name = preset.title();
            let players = preset.rules().players;
            Meta {
                title: format!("{name} 마이티 규칙 · 마이티"),
                description: format!(
                    "{name}에서 치는 {players}인 마이티 규칙: 공약, 기루다, 프렌드, 마이티와 조커, 점수 계산까지 한눈에."
                ),
                path: Some(format!("/rules/{}", preset.name())),
                noindex: false,
            }
        }
        Page::Room(id) => {
            let mut title = "마이티 한 판 하실래요?".to_string();
            if let Some(table) = table {
                if let Some(preset) = table.preset {
                    let custom = if table.custom { " (바꾼 규칙)" } else { "" };
                    title.push_str(&format!(" · {} 규칙{custom}", preset.title()));
                }
                title.push_str(&if table.empty > 0 {
                    format!(" · 빈 자리 {}", table.empty)
                } else {
                    " · 자리 꽉 참".to_string()
                });
            }
            Meta {
                title,
                description: SHARE_DESCRIPTION.into(),
                path: Some(format!("/r/{id}")),
                noindex: true,
            }
        }
        Page::Tool => Meta {
            title: "마이티".into(),
            description: DESCRIPTION.into(),
            path: Some(path.to_string()),
            noindex: true,
        },
        Page::NotFound => Meta {
            title: "페이지를 찾을 수 없어요 · 마이티".into(),
            description: DESCRIPTION.into(),
            path: None,
            noindex: true,
        },
    }
}

/// Escapes text for HTML, attributes included.
pub fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
    out
}

/// Replaces the first tag starting with `start` (up to its `>`) with `tag`,
/// or adds `tag` at the end of the head.
fn put_tag(html: &mut String, start: &str, tag: &str) {
    if let Some(at) = html.find(start)
        && let Some(len) = html[at..].find('>')
    {
        html.replace_range(at..=at + len, tag);
    } else if let Some(at) = html.find("</head>") {
        html.insert_str(at, &format!("{tag}\n  "));
    }
}

/// `index.html` with `meta` in its head, and the Cloudflare Web Analytics
/// beacon before `</body>` when given its token.
pub fn render(template: &str, meta: &Meta, site: &str, beacon: Option<&str>) -> String {
    let mut html = template.to_string();
    let title = escape(&meta.title);
    let description = escape(&meta.description);
    match (html.find("<title>"), html.find("</title>")) {
        (Some(open), Some(close)) if open < close => {
            html.replace_range(open..close + 8, &format!("<title>{title}</title>"))
        }
        _ => put_tag(&mut html, "<title>", &format!("<title>{title}</title>")),
    }
    put_tag(
        &mut html,
        "<meta name=\"description\"",
        &format!("<meta name=\"description\" content=\"{description}\" />"),
    );
    put_tag(
        &mut html,
        "<meta property=\"og:title\"",
        &format!("<meta property=\"og:title\" content=\"{title}\" />"),
    );
    put_tag(
        &mut html,
        "<meta property=\"og:description\"",
        &format!("<meta property=\"og:description\" content=\"{description}\" />"),
    );
    if let Some(path) = &meta.path {
        let url = escape(&format!("{site}{path}"));
        put_tag(
            &mut html,
            "<meta property=\"og:url\"",
            &format!("<meta property=\"og:url\" content=\"{url}\" />"),
        );
        put_tag(
            &mut html,
            "<link rel=\"canonical\"",
            &format!("<link rel=\"canonical\" href=\"{url}\" />"),
        );
    }
    if meta.noindex {
        put_tag(
            &mut html,
            "<meta name=\"robots\"",
            "<meta name=\"robots\" content=\"noindex\" />",
        );
    }
    if let Some(token) = beacon
        && let Some(at) = html.rfind("</body>")
    {
        // JSON inside a single-quoted attribute: escape what would end
        // either, so a token cannot break out of the tag.
        let json = serde_json::to_string(&serde_json::json!({ "token": token })).expect("json");
        let attr = json
            .replace('&', "&amp;")
            .replace('\'', "&#39;")
            .replace('<', "&lt;")
            .replace('>', "&gt;");
        let script = format!(
            "<script defer src=\"https://static.cloudflareinsights.com/beacon.min.js\" data-cf-beacon='{attr}'></script>\n  "
        );
        html.insert_str(at, &script);
    }
    html
}

/// The status a page is served with.
pub fn status(page: &Page) -> StatusCode {
    match page {
        Page::NotFound => StatusCode::NOT_FOUND,
        _ => StatusCode::OK,
    }
}

/// Everything not routed elsewhere: a built file if there is one, else the
/// app's page for the path. API paths and missing build files are plain 404s.
pub async fn fallback(State(app): State<AppState>, req: Request) -> Response {
    let path = req.uri().path().to_string();
    let Some(dir) = app.web.clone() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if path.starts_with("/api/") || path == "/api" || path.starts_with("/internal/") {
        return StatusCode::NOT_FOUND.into_response();
    }
    if req.method() != Method::GET && req.method() != Method::HEAD {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    if path != "/" && path != "/index.html" {
        let files = ServeDir::new(&dir).append_index_html_on_directories(false);
        if let Ok(response) = files.oneshot(req).await
            && response.status() != StatusCode::NOT_FOUND
        {
            return response.map(Body::new);
        }
        if path.starts_with("/assets/") {
            return StatusCode::NOT_FOUND.into_response();
        }
    }
    let Ok(template) = tokio::fs::read_to_string(dir.join("index.html")).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let page = Page::at(&path);
    let table = match &page {
        Page::Room(id) => app.table_info(id).await,
        _ => None,
    };
    let html = render(
        &template,
        &meta(&page, &path, table.as_ref()),
        &app.site_url,
        app.beacon.as_deref(),
    );
    let mut response = (status(&page), html).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    response
}

impl AppState {
    /// Asks the room for its preset and empty seats, briefly.
    async fn table_info(&self, id: &str) -> Option<TableInfo> {
        let tx = self.room(id)?;
        let (reply, rx) = tokio::sync::oneshot::channel();
        tx.send(Command::Describe { reply }).ok()?;
        let info: Value = tokio::time::timeout(Duration::from_secs(1), rx).await.ok()?.ok()?;
        Some(TableInfo {
            preset: info["preset"].as_str().and_then(|p| p.parse().ok()),
            custom: info["custom"].as_bool().unwrap_or(false),
            empty: info["empty"].as_u64().unwrap_or(0) as usize,
        })
    }
}

pub async fn robots_txt(State(app): State<AppState>) -> Response {
    (
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        robots(&app.site_url),
    )
        .into_response()
}

pub async fn sitemap_xml(State(app): State<AppState>) -> Response {
    (
        [(header::CONTENT_TYPE, "application/xml; charset=utf-8")],
        sitemap(&app.site_url),
    )
        .into_response()
}

/// Headers every response carries; Caddy adds the rest (HSTS, CSP) in production.
pub async fn base_headers(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers
        .entry(header::X_CONTENT_TYPE_OPTIONS)
        .or_insert(HeaderValue::from_static("nosniff"));
    headers
        .entry(header::REFERRER_POLICY)
        .or_insert(HeaderValue::from_static("strict-origin-when-cross-origin"));
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEMPLATE: &str = r#"<!doctype html>
<html lang="ko">
  <head>
    <meta name="description" content="친구들과 마이티 한 판" />
    <meta property="og:title" content="마이티 한 판 하실래요?" />
    <meta property="og:description" content="링크를 누르면 바로 테이블에 앉아요." />
    <meta property="og:image" content="https://cards.buttercrab.io/og.png" />
    <title>마이티</title>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>"#;

    #[test]
    fn robots_keeps_crawlers_off_private_paths_and_points_to_the_sitemap() {
        let robots = robots(SITE_URL);
        for path in ["/api/", "/internal/", "/stats", "/r/"] {
            assert!(robots.contains(&format!("Disallow: {path}\n")), "{path}");
        }
        assert!(robots.contains("Sitemap: https://cards.buttercrab.io/sitemap.xml"));
    }

    #[test]
    fn the_sitemap_lists_the_pages_and_every_rulebook() {
        let xml = sitemap(SITE_URL);
        assert!(xml.contains("<loc>https://cards.buttercrab.io/</loc>"));
        assert!(xml.contains("<loc>https://cards.buttercrab.io/about</loc>"));
        assert!(xml.contains("<loc>https://cards.buttercrab.io/privacy</loc>"));
        for preset in Preset::ALL {
            assert!(xml.contains(&format!("/rules/{}</loc>", preset.name())), "{preset}");
        }
        assert_eq!(xml.matches("<url>").count(), 3 + Preset::ALL.len());
        assert!(!xml.contains("/r/"));
    }

    #[test]
    fn app_routes_are_pages_and_everything_else_is_not_found() {
        assert_eq!(Page::at("/"), Page::Home);
        assert_eq!(Page::at("/r/abc234"), Page::Room("abc234".into()));
        assert_eq!(Page::at("/r/abc234/"), Page::Room("abc234".into()));
        assert_eq!(Page::at("/rules/gshs"), Page::Rules(Preset::Gshs));
        assert_eq!(Page::at("/about"), Page::About);
        assert_eq!(Page::at("/privacy"), Page::Privacy);
        for tool in ["/deck", "/preview", "/share"] {
            assert_eq!(Page::at(tool), Page::Tool);
        }
        for missing in [
            "/rules/nowhere",
            "/r/",
            "/r/ABC",
            "/r/a/b",
            "/wp-login.php",
            "/about/x",
            "/rooms",
        ] {
            assert_eq!(Page::at(missing), Page::NotFound, "{missing}");
            assert_eq!(status(&Page::at(missing)), StatusCode::NOT_FOUND);
        }
        assert_eq!(status(&Page::Home), StatusCode::OK);
    }

    #[test]
    fn every_preset_has_a_korean_name() {
        for preset in Preset::ALL {
            assert!(!preset.title().is_ascii(), "{preset}");
        }
    }

    #[test]
    fn a_rulebook_page_names_its_preset() {
        let page = Page::at("/rules/gshs");
        let html = render(TEMPLATE, &meta(&page, "/rules/gshs", None), SITE_URL, None);
        assert!(html.contains("<title>경기과고 마이티 규칙 · 마이티</title>"), "{html}");
        assert!(html.contains(r#"<meta property="og:title" content="경기과고 마이티 규칙 · 마이티" />"#));
        assert!(html.contains(r#"<meta name="description" content="경기과고에서 치는 "#));
        assert!(html.contains(r#"<meta property="og:description" content="경기과고에서 치는 "#));
        assert!(html.contains(r#"<meta property="og:url" content="https://cards.buttercrab.io/rules/gshs" />"#));
        assert!(html.contains(r#"<link rel="canonical" href="https://cards.buttercrab.io/rules/gshs" />"#));
        assert!(html.contains("og.png"), "the image stays");
        assert_eq!(html.matches("og:title").count(), 1, "replaced, not added");
        assert_eq!(html.matches("<title>").count(), 1);
        assert!(!html.contains("noindex"));
        assert!(!html.contains("cloudflareinsights"));
    }

    #[test]
    fn a_share_link_describes_its_table() {
        let page = Page::Room("abc234".into());
        let table = TableInfo {
            preset: Some(Preset::Gshs),
            custom: false,
            empty: 2,
        };
        let m = meta(&page, "/r/abc234", Some(&table));
        assert_eq!(m.title, "마이티 한 판 하실래요? · 경기과고 규칙 · 빈 자리 2");
        let html = render(TEMPLATE, &m, SITE_URL, None);
        assert!(html.contains(r#"content="마이티 한 판 하실래요? · 경기과고 규칙 · 빈 자리 2""#));
        assert!(html.contains(r#"<meta name="robots" content="noindex" />"#));
        let full = TableInfo { empty: 0, ..table };
        assert!(meta(&page, "/r/abc234", Some(&full)).title.ends_with("자리 꽉 참"));
        assert_eq!(meta(&page, "/r/abc234", None).title, "마이티 한 판 하실래요?");
    }

    #[test]
    fn about_and_privacy_have_their_own_titles() {
        let about = render(TEMPLATE, &meta(&Page::About, "/about", None), SITE_URL, None);
        assert!(about.contains("<title>마이티 소개 · 마이티</title>"));
        let privacy = render(TEMPLATE, &meta(&Page::Privacy, "/privacy", None), SITE_URL, None);
        assert!(privacy.contains("<title>개인정보 처리방침 · 마이티</title>"));
        assert!(privacy.contains(r#"href="https://cards.buttercrab.io/privacy""#));
        let missing = render(TEMPLATE, &meta(&Page::NotFound, "/nope", None), SITE_URL, None);
        assert!(!missing.contains("canonical"));
        assert!(missing.contains("noindex"));
    }

    #[test]
    fn the_beacon_goes_before_the_body_ends_and_cannot_break_out() {
        let m = meta(&Page::Home, "/", None);
        let html = render(TEMPLATE, &m, SITE_URL, Some("abc123"));
        assert!(html.contains(
            r#"<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"abc123"}'></script>"#
        ));
        assert!(html.find("beacon.min.js").unwrap() < html.find("</body>").unwrap());
        let evil = render(TEMPLATE, &m, SITE_URL, Some("x'><script>alert(1)</script>"));
        assert!(!evil.contains("<script>alert"), "{evil}");
        assert!(evil.contains("x&#39;&gt;&lt;script"));
    }

    #[test]
    fn text_from_a_table_is_escaped() {
        let m = Meta {
            title: "a\"<b>&".into(),
            description: "'".into(),
            path: Some("/x\"".into()),
            noindex: false,
        };
        let html = render(TEMPLATE, &m, SITE_URL, None);
        assert!(html.contains("<title>a&quot;&lt;b&gt;&amp;</title>"));
        assert!(html.contains(r#"content="&#39;""#));
        assert!(html.contains(r#"href="https://cards.buttercrab.io/x&quot;""#));
    }

    #[test]
    fn missing_tags_are_added_to_the_head() {
        let bare = "<html><head></head><body></body></html>";
        let html = render(bare, &meta(&Page::Home, "/", None), SITE_URL, None);
        let head = &html[..html.find("</head>").unwrap()];
        for tag in [
            "<title>",
            "name=\"description\"",
            "og:title",
            "og:description",
            "og:url",
            "canonical",
        ] {
            assert!(head.contains(tag), "{tag}: {html}");
        }
    }
}
