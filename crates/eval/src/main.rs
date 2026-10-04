use clap::{Parser, Subcommand};
use eval::report;
use eval::run::{Request, run};
use eval::suite::{Loaded, Part};
use mighty::Mighty;
use std::path::PathBuf;
use std::process::ExitCode;

/// Run eval suites: see research/evals/README.md.
#[derive(Parser)]
struct Args {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Play a suite with one bot (and a baseline) and write results.json
    /// and report.md. Run it at low priority (`nice -n 10`) on shared
    /// machines.
    Run {
        /// A suite name in research/evals (`v1`), or a suite file or folder.
        #[arg(long)]
        suite: String,
        /// The bot under test, by `sim`'s names: `hard`, `search:400:1:0`, ...
        #[arg(long)]
        bot: String,
        /// Also play every deal with this bot in the measured seat, and
        /// report the difference.
        #[arg(long)]
        baseline: Option<String>,
        /// Where to write; target/eval/<suite> when omitted.
        #[arg(long)]
        out: Option<PathBuf>,
        /// A few deals of everything, to see that it runs (minutes).
        #[arg(long)]
        quick: bool,
        /// Only these parts, comma-separated; all of the suite's when omitted.
        #[arg(long, value_enum, value_delimiter = ',')]
        parts: Vec<Part>,
        /// Worker threads; all cores when omitted.
        #[arg(long)]
        threads: Option<usize>,
        /// Which machine this is, for the record (results are public: no
        /// host names needed).
        #[arg(long)]
        machine: Option<String>,
    },
}

fn main() -> ExitCode {
    let Command::Run {
        suite,
        bot,
        baseline,
        out,
        quick,
        parts,
        threads,
        machine,
    } = Args::parse().command;
    let result = (|| {
        let loaded = Loaded::load(&suite)?;
        let parts = if parts.is_empty() { Part::ALL.to_vec() } else { parts };
        let request = Request {
            suite: &loaded,
            bot: &bot,
            baseline: baseline.as_deref(),
            quick,
            parts: &parts,
            threads,
            machine,
            command: std::env::args().collect(),
        };
        let mut progress = |line: &str| eprintln!("{line}");
        let results = match loaded.suite.game.as_str() {
            "mighty" => run::<Mighty>(&request, &mut progress)?,
            game => return Err(format!("no evals for game {game:?}")),
        };
        let out = out.unwrap_or_else(|| PathBuf::from("target/eval").join(&loaded.suite.suite));
        std::fs::create_dir_all(&out).map_err(|e| format!("{}: {e}", out.display()))?;
        let json = serde_json::to_string_pretty(&results).expect("results serialize") + "\n";
        let write = |name: &str, text: &str| {
            let path = out.join(name);
            std::fs::write(&path, text).map_err(|e| format!("{}: {e}", path.display()))
        };
        write("results.json", &json)?;
        write("report.md", &report::markdown(&results))?;
        eprintln!("wrote {}", out.display());
        Ok(())
    })();
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("eval: {e}");
            ExitCode::FAILURE
        }
    }
}
