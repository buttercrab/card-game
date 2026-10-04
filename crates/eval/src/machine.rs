//! Where and from what a run ran: the commit, the machine, the time.
//! Think times only mean something next to the machine they were taken
//! on, and every result only next to its commit.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

/// The commit checked out at `dir`, and whether tracked files differ
/// from it. `None` outside a git checkout.
pub fn commit(dir: &Path) -> Option<(String, bool)> {
    let git = |args: &[&str]| {
        let out = Command::new("git").arg("-C").arg(dir).args(args).output().ok()?;
        out.status
            .success()
            .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
    };
    let hash = git(&["rev-parse", "HEAD"])?;
    let dirty = !git(&["status", "--porcelain", "--untracked-files=no"])?.is_empty();
    Some((hash, dirty))
}

/// The machine, as far as it matters for think time. No host name: the
/// results are public, so `label` says which machine it was if anyone.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Machine {
    pub label: Option<String>,
    pub os: String,
    pub arch: String,
    pub cpu: Option<String>,
    /// Threads the machine offers.
    pub threads: usize,
    /// One-, five- and fifteen-minute load averages when the run started:
    /// anything else running slows think times.
    pub load: Option<[f64; 3]>,
}

impl Machine {
    pub fn here(label: Option<String>) -> Machine {
        Machine {
            label,
            os: std::env::consts::OS.into(),
            arch: std::env::consts::ARCH.into(),
            cpu: cpu(),
            threads: std::thread::available_parallelism().map_or(1, |n| n.get()),
            load: load(),
        }
    }
}

fn cpu() -> Option<String> {
    if cfg!(target_os = "macos") {
        let out = Command::new("sysctl")
            .args(["-n", "machdep.cpu.brand_string"])
            .output()
            .ok()?;
        let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (!name.is_empty()).then_some(name)
    } else {
        let info = std::fs::read_to_string("/proc/cpuinfo").ok()?;
        let line = info.lines().find(|l| l.starts_with("model name"))?;
        Some(line.split_once(':')?.1.trim().to_string())
    }
}

fn load() -> Option<[f64; 3]> {
    let text = if cfg!(target_os = "macos") {
        // "{ 1.23 1.45 1.67 }"
        let out = Command::new("sysctl").args(["-n", "vm.loadavg"]).output().ok()?;
        String::from_utf8_lossy(&out.stdout).into_owned()
    } else {
        std::fs::read_to_string("/proc/loadavg").ok()?
    };
    let mut numbers = text.split_whitespace().filter_map(|w| w.parse::<f64>().ok()).take(3);
    Some([numbers.next()?, numbers.next()?, numbers.next()?])
}

/// Now, as `YYYY-MM-DDTHH:MM:SSZ`.
pub fn now_utc() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
    utc(secs)
}

/// Seconds since 1970 as `YYYY-MM-DDTHH:MM:SSZ`.
fn utc(secs: u64) -> String {
    let (days, rest) = (secs / 86_400, secs % 86_400);
    // Civil date from a day count (Howard Hinnant's algorithm), with eras
    // of 400 years starting on 0000-03-01.
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / 3600,
        rest / 60 % 60,
        rest % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utc_dates() {
        assert_eq!(utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(utc(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(utc(1_791_158_399), "2026-10-04T23:59:59Z");
    }

    #[test]
    fn this_machine_describes_itself() {
        let m = Machine::here(Some("test".into()));
        assert!(m.threads >= 1);
        assert_eq!(m.os, std::env::consts::OS);
    }
}
