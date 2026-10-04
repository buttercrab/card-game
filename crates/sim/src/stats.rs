//! The statistics reported on games: means with 95% confidence intervals,
//! and quantiles of think times.

/// The mean, and the half-width of its 95% confidence interval (1.96
/// standard errors; normal approximation).
pub fn mean_and_margin(xs: &[f64]) -> (f64, f64) {
    let n = xs.len() as f64;
    let mean = xs.iter().sum::<f64>() / n;
    let var = xs.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (n - 1.0).max(1.0);
    (mean, 1.96 * (var / n).sqrt())
}

/// The `q` quantile (0 to 1) of `sorted`, which must be sorted and not
/// empty: the nearest value by rank.
pub fn quantile(sorted: &[f64], q: f64) -> f64 {
    sorted[((sorted.len() - 1) as f64 * q).round() as usize]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn margin_is_two_standard_errors() {
        let (mean, margin) = mean_and_margin(&[1.0, 3.0, 1.0, 3.0]);
        assert_eq!(mean, 2.0);
        // Sample variance 4/3, standard error 1/√3.
        assert!((margin - 1.96 / 3f64.sqrt()).abs() < 1e-12);
    }

    #[test]
    fn quantiles_take_the_nearest_rank() {
        let xs: Vec<f64> = (0..=100).map(f64::from).collect();
        assert_eq!(quantile(&xs, 0.5), 50.0);
        assert_eq!(quantile(&xs, 0.99), 99.0);
        assert_eq!(quantile(&[7.0], 0.99), 7.0);
    }
}
