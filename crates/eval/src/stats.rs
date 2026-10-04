//! Estimates with 95% intervals, and think-time summaries.

use serde::{Deserialize, Serialize};
use sim::stats::{mean_and_margin, quantile};
use std::fmt;
use std::time::Duration;

/// A mean and the half-width of its 95% confidence interval (1.96
/// standard errors, normal approximation), over `n` results.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Estimate {
    pub mean: f64,
    pub ci95: f64,
    pub n: usize,
}

impl Estimate {
    /// The mean of `xs`, which must not be empty.
    pub fn of(xs: &[f64]) -> Estimate {
        let (mean, ci95) = mean_and_margin(xs);
        Estimate {
            mean,
            ci95,
            n: xs.len(),
        }
    }

    /// The equal-weight mean of independent estimates, such as one per
    /// opponent or rule set: each counts once however its spread, and
    /// the interval adds their variances (`ci = √Σci² / k`).
    pub fn average(parts: &[Estimate]) -> Estimate {
        let k = parts.len() as f64;
        Estimate {
            mean: parts.iter().map(|e| e.mean).sum::<f64>() / k,
            ci95: parts.iter().map(|e| e.ci95.powi(2)).sum::<f64>().sqrt() / k,
            n: parts.iter().map(|e| e.n).sum(),
        }
    }
}

impl fmt::Display for Estimate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:+.2} ± {:.2}", self.mean, self.ci95)
    }
}

/// A bot's think time per decision with a real choice, in milliseconds.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ThinkTime {
    pub decisions: usize,
    pub mean_ms: f64,
    pub median_ms: f64,
    pub p90_ms: f64,
    pub p99_ms: f64,
    pub max_ms: f64,
}

impl ThinkTime {
    /// `None` when there was no decision to time.
    pub fn of(times: &[Duration]) -> Option<ThinkTime> {
        let mut ms: Vec<f64> = times.iter().map(|t| t.as_secs_f64() * 1000.0).collect();
        ms.sort_by(f64::total_cmp);
        let max_ms = *ms.last()?;
        Some(ThinkTime {
            decisions: ms.len(),
            mean_ms: ms.iter().sum::<f64>() / ms.len() as f64,
            median_ms: quantile(&ms, 0.5),
            p90_ms: quantile(&ms, 0.9),
            p99_ms: quantile(&ms, 0.99),
            max_ms,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_average_weighs_each_part_once() {
        let a = Estimate {
            mean: 1.0,
            ci95: 0.3,
            n: 10,
        };
        let b = Estimate {
            mean: 3.0,
            ci95: 0.4,
            n: 1000,
        };
        let avg = Estimate::average(&[a, b]);
        assert_eq!(avg.mean, 2.0);
        assert!((avg.ci95 - 0.25).abs() < 1e-12);
        assert_eq!(avg.n, 1010);
    }

    #[test]
    fn think_time_needs_a_decision() {
        assert_eq!(ThinkTime::of(&[]), None);
        let times: Vec<Duration> = (1..=100).map(Duration::from_millis).collect();
        let t = ThinkTime::of(&times).expect("decisions");
        assert_eq!((t.decisions, t.median_ms, t.max_ms), (100, 51.0, 100.0));
    }
}
