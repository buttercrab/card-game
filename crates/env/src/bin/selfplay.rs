//! Generates a self-play dataset from a config and records its manifest:
//!
//! ```sh
//! nice -n 10 cargo run --release -p env --bin selfplay -- \
//!     --config research/experiments/<folder>/config.toml
//! ```
//!
//! Shards go to `$CARDGAME_ARTIFACTS/selfplay/<name>/` (by default
//! `~/card-game-artifacts`), the manifest to
//! `research/manifests/<name>.json`. Run it from a clean checkout: the
//! manifest names the commit.

use clap::Parser;
use env::selfplay::{self, Config, Provenance};
use mighty::Mighty;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Parser)]
struct Args {
    /// The dataset's config (TOML), inside the repository.
    #[arg(long)]
    config: PathBuf,
    /// Worker threads; all cores when omitted.
    #[arg(long, default_value_t = 0)]
    threads: usize,
    /// Also write the run's statistics here, as JSON.
    #[arg(long)]
    stats: Option<PathBuf>,
    /// Run with uncommitted changes; the manifest's commit then does not
    /// reproduce the data.
    #[arg(long)]
    allow_dirty: bool,
}

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|e| format!("git: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "git {}: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// The artifact store: `$CARDGAME_ARTIFACTS`, else `~/card-game-artifacts`.
fn store() -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os("CARDGAME_ARTIFACTS") {
        return Ok(PathBuf::from(dir));
    }
    let home = std::env::var_os("HOME").ok_or("neither CARDGAME_ARTIFACTS nor HOME is set")?;
    Ok(PathBuf::from(home).join("card-game-artifacts"))
}

/// Today in UTC as `YYYY-MM-DD` (days to civil date, after Howard Hinnant).
fn today() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("after 1970")
        .as_secs();
    let z = (secs / 86_400) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

fn run(args: &Args) -> Result<(), String> {
    let root = PathBuf::from(git(Path::new("."), &["rev-parse", "--show-toplevel"])?);
    let commit = git(&root, &["rev-parse", "HEAD"])?;
    let changes = git(&root, &["status", "--porcelain", "--untracked-files=no"])?;
    if !args.allow_dirty && !changes.is_empty() {
        return Err("uncommitted changes: commit first, or pass --allow-dirty".into());
    }
    let config_path = std::fs::canonicalize(&args.config).map_err(|e| format!("{}: {e}", args.config.display()))?;
    let in_repo = config_path
        .strip_prefix(std::fs::canonicalize(&root).map_err(|e| e.to_string())?)
        .map_err(|_| "the config must be inside the repository")?
        .to_string_lossy()
        .into_owned();
    let text = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let config = Config::from_toml(&text).map_err(|e| e.to_string())?;

    let prefix = format!("selfplay/{}", config.name);
    let out = store()?.join(&prefix);
    std::fs::create_dir_all(out.parent().expect("a parent")).map_err(|e| e.to_string())?;
    eprintln!("writing {}", out.display());
    let dataset = selfplay::run::<Mighty>(&config, &root, &out, args.threads, |games| {
        eprint!("\r{games}/{} games", config.games);
    })
    .map_err(|e| e.to_string())?;
    eprintln!();

    let provenance = Provenance {
        commit,
        config: in_repo,
        created: today(),
    };
    let manifest = selfplay::manifest(&config, &dataset, &out, &prefix, &provenance).map_err(|e| e.to_string())?;
    let manifest_path = root.join("research/manifests").join(format!("{}.json", config.name));
    selfplay::write_json(&manifest_path, &manifest).map_err(|e| e.to_string())?;
    let mut stats = serde_json::to_value(&dataset.stats).expect("stats serialize");
    stats["seconds"] = dataset.seconds.round().into();
    stats["decisions_per_second"] = (dataset.stats.decisions as f64 / dataset.seconds).round().into();
    stats["threads"] = match args.threads {
        0 => rayon::current_num_threads(),
        n => n,
    }
    .into();
    if let Some(path) = &args.stats {
        selfplay::write_json(path, &stats).map_err(|e| e.to_string())?;
    }
    println!("{}", serde_json::to_string_pretty(&stats).expect("JSON"));
    eprintln!("manifest: {}", manifest_path.display());
    Ok(())
}

fn main() -> ExitCode {
    match run(&Args::parse()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("selfplay: {e}");
            ExitCode::FAILURE
        }
    }
}
