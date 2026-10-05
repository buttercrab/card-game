//! Rate limits: in-memory token buckets keyed by IP address, the same per
//! WebSocket connection, and a cap on hint searches running at once.

use crate::protocol::{ErrorCode, ServerError};
use axum::extract::{ConnectInfo, FromRequestParts};
use axum::http::StatusCode;
use axum::http::request::Parts;
use axum::response::Response;
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::sync::{Semaphore, SemaphorePermit};

/// Up to `burst` at once, refilled at `per_minute`.
pub struct Limiter {
    per_minute: f64,
    burst: f64,
    buckets: Mutex<HashMap<IpAddr, Bucket>>,
}

struct Bucket {
    tokens: f64,
    at: Instant,
}

/// Forget buckets past this many clients, keeping only those still drained.
const MAX_CLIENTS: usize = 10_000;

impl Limiter {
    pub fn new(per_minute: u32, burst: u32) -> Limiter {
        Limiter {
            per_minute: f64::from(per_minute),
            burst: f64::from(burst.max(1)),
            buckets: Mutex::default(),
        }
    }

    /// Takes a token for `ip` if one is left.
    pub fn allow(&self, ip: IpAddr) -> bool {
        self.allow_at(ip, Instant::now())
    }

    pub fn allow_at(&self, ip: IpAddr, now: Instant) -> bool {
        let mut buckets = self.buckets.lock().expect("rate limiter poisoned");
        if buckets.len() >= MAX_CLIENTS && !buckets.contains_key(&ip) {
            buckets.retain(|_, b| self.refill(b, now) < self.burst);
        }
        let bucket = buckets.entry(ip).or_insert(Bucket {
            tokens: self.burst,
            at: now,
        });
        bucket.tokens = self.refill(bucket, now);
        bucket.at = now;
        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            true
        } else {
            false
        }
    }

    fn refill(&self, bucket: &Bucket, now: Instant) -> f64 {
        let elapsed = now.saturating_duration_since(bucket.at).as_secs_f64();
        (bucket.tokens + elapsed * self.per_minute / 60.0).min(self.burst)
    }
}

/// One connection's own bucket: up to `burst` at once, refilled at `per_minute`.
pub struct ConnBucket {
    per_minute: f64,
    burst: f64,
    bucket: Bucket,
}

impl ConnBucket {
    pub fn new(per_minute: u32, burst: u32) -> ConnBucket {
        let burst = f64::from(burst.max(1));
        ConnBucket {
            per_minute: f64::from(per_minute),
            burst,
            bucket: Bucket {
                tokens: burst,
                at: Instant::now(),
            },
        }
    }

    /// Takes a token if one is left.
    pub fn take(&mut self) -> bool {
        self.take_at(Instant::now())
    }

    pub fn take_at(&mut self, now: Instant) -> bool {
        let elapsed = now.saturating_duration_since(self.bucket.at).as_secs_f64();
        self.bucket.tokens = (self.bucket.tokens + elapsed * self.per_minute / 60.0).min(self.burst);
        self.bucket.at = now;
        if self.bucket.tokens >= 1.0 {
            self.bucket.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

/// Hint searches (a 고수 bot thinking for a player) running at once, across
/// the whole server: each keeps a CPU busy for most of a second, and the
/// server has few.
pub const HINT_SEARCHES: usize = 2;

pub static HINTS: Semaphore = Semaphore::const_new(HINT_SEARCHES);

/// A place for one hint search, or `None` while [`HINT_SEARCHES`] already run.
pub fn hint_permit() -> Option<SemaphorePermit<'static>> {
    HINTS.try_acquire().ok()
}

/// The largest WebSocket message or frame a client may send. Its biggest,
/// a table's full rules, is a few kilobytes.
pub const WS_MAX_MESSAGE: usize = 64 * 1024;

/// What one table connection may send: a burst, then five messages a second.
pub fn ws_messages() -> ConnBucket {
    ConnBucket::new(300, 40)
}

/// A connection that sends this many messages past its limit is closed.
pub const WS_FLOOD: u32 = 100;

/// Hints one connection may ask for: a few in a row, then one every five seconds.
pub fn ws_hints() -> ConnBucket {
    ConnBucket::new(12, 4)
}

/// At most `max` in any hour, from everyone together.
pub struct HourlyCap {
    max: usize,
    times: Mutex<Vec<Instant>>,
}

impl HourlyCap {
    pub fn new(max: usize) -> HourlyCap {
        HourlyCap {
            max,
            times: Mutex::default(),
        }
    }

    /// Takes one of the hour's places if one is left.
    pub fn take(&self) -> bool {
        let now = Instant::now();
        let mut times = self.times.lock().expect("hourly cap poisoned");
        times.retain(|t| now.saturating_duration_since(*t) < Duration::from_secs(3600));
        if times.len() >= self.max {
            return false;
        }
        times.push(now);
        true
    }
}

/// Problem reports saved at most this often, from everyone.
pub const REPORTS_PER_HOUR: usize = 30;

/// New client errors filed as issues at most this often, so a flood of
/// made-up errors cannot flood the issue tracker.
pub const ISSUES_PER_HOUR: usize = 5;

/// The limits the server applies.
pub struct Limits {
    pub tables: Limiter,
    pub reports: Limiter,
    pub errors: Limiter,
    pub sockets: Limiter,
    /// Problem reports saved, from everyone.
    pub report_files: HourlyCap,
    /// New client errors saved for an issue, from everyone.
    pub error_issues: HourlyCap,
}

impl Default for Limits {
    fn default() -> Limits {
        Limits {
            tables: Limiter::new(10, 10),
            reports: Limiter::new(5, 5),
            errors: Limiter::new(30, 30),
            // A client reconnects on its own after a drop, so leave room.
            sockets: Limiter::new(60, 60),
            report_files: HourlyCap::new(REPORTS_PER_HOUR),
            error_issues: HourlyCap::new(ISSUES_PER_HOUR),
        }
    }
}

/// The answer once a client is over its limit.
pub fn too_many() -> Response {
    ServerError::new(ErrorCode::RateLimited).respond(StatusCode::TOO_MANY_REQUESTS)
}

/// The client's address: from `X-Forwarded-For` when the request came
/// through a proxy on this machine or network (Caddy), else the peer's.
pub struct ClientIp(pub IpAddr);

impl<S: Send + Sync> FromRequestParts<S> for ClientIp {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<ClientIp, Self::Rejection> {
        let peer = parts.extensions.get::<ConnectInfo<SocketAddr>>().map(|c| c.0.ip());
        Ok(ClientIp(client_ip(
            peer,
            parts.headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()),
        )))
    }
}

fn client_ip(peer: Option<IpAddr>, forwarded: Option<&str>) -> IpAddr {
    let trusted = peer.is_none_or(|ip| match ip {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_private(),
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6
                    .to_ipv4_mapped()
                    .is_some_and(|v4| v4.is_loopback() || v4.is_private())
        }
    });
    // The proxy appends the address it saw, so the last entry is the one to trust.
    let from_proxy = forwarded
        .filter(|_| trusted)
        .and_then(|f| f.rsplit(',').next())
        .and_then(|ip| ip.trim().parse().ok());
    from_proxy.or(peer).unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn a_bucket_allows_a_burst_then_refills() {
        let limiter = Limiter::new(6, 3);
        let (a, b): (IpAddr, IpAddr) = ("1.2.3.4".parse().unwrap(), "5.6.7.8".parse().unwrap());
        let t = Instant::now();
        assert!((0..3).all(|_| limiter.allow_at(a, t)));
        assert!(!limiter.allow_at(a, t));
        assert!(limiter.allow_at(b, t), "clients have their own buckets");
        // Six a minute is one every ten seconds.
        assert!(!limiter.allow_at(a, t + Duration::from_secs(9)));
        assert!(limiter.allow_at(a, t + Duration::from_secs(10)));
        assert!(!limiter.allow_at(a, t + Duration::from_secs(11)));
        // Idle time fills the bucket no further than the burst.
        let later = t + Duration::from_secs(3600);
        assert!((0..3).all(|_| limiter.allow_at(a, later)));
        assert!(!limiter.allow_at(a, later));
    }

    #[test]
    fn a_connection_bucket_allows_a_burst_then_refills() {
        let mut bucket = ConnBucket::new(60, 2);
        let t = Instant::now();
        assert!(bucket.take_at(t) && bucket.take_at(t));
        assert!(!bucket.take_at(t));
        assert!(!bucket.take_at(t + Duration::from_millis(900)));
        assert!(bucket.take_at(t + Duration::from_millis(1100)));
    }

    #[test]
    fn hint_searches_are_capped_across_the_server() {
        let held: Vec<_> = (0..HINT_SEARCHES)
            .map(|_| hint_permit().expect("a free place"))
            .collect();
        assert!(hint_permit().is_none(), "every place is taken");
        drop(held);
        assert!(hint_permit().is_some());
    }

    #[test]
    fn the_forwarded_address_counts_only_behind_a_local_proxy() {
        let caddy = Some("172.18.0.3".parse().unwrap());
        let outside = Some("203.0.113.9".parse().unwrap());
        let ip = |s: &str| s.parse::<IpAddr>().unwrap();
        assert_eq!(client_ip(caddy, Some("198.51.100.7")), ip("198.51.100.7"));
        assert_eq!(client_ip(caddy, Some("10.0.0.1, 198.51.100.7")), ip("198.51.100.7"));
        assert_eq!(client_ip(outside, Some("198.51.100.7")), ip("203.0.113.9"), "spoofed");
        assert_eq!(client_ip(caddy, Some("garbage")), ip("172.18.0.3"));
        assert_eq!(client_ip(None, None), ip("0.0.0.0"));
    }
}
