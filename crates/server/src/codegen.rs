//! The files the web client is built from, generated from the server's own
//! definitions: `protocol.ts`, the TypeScript types of every message (see
//! [`crate::protocol`]). `server --write-generated web/src/lib/generated`
//! writes them; a test and CI fail when the committed ones are stale.

use crate::protocol::ServerError;
use std::any::TypeId;
use std::collections::HashSet;
use std::path::Path;
use ts_rs::{Config, TS, TypeVisitor};

/// Where the generated files live, from the workspace root.
pub const DIR: &str = "web/src/lib/generated";

const HEADER: &str = "// Generated from the server's Rust types (crates/server/src/codegen.rs).\n\
// Do not edit: run `cargo run -p server -- --write-generated web/src/lib/generated`.\n";

/// Collects the declarations of a type and everything it refers to, each
/// once, in the order first met.
struct Declarations {
    cfg: Config,
    seen: HashSet<TypeId>,
    out: Vec<String>,
}

impl TypeVisitor for Declarations {
    fn visit<T: TS + 'static + ?Sized>(&mut self) {
        if !self.seen.insert(TypeId::of::<T>()) {
            return;
        }
        // Only declared types (derived ones) have a file of their own;
        // containers such as `Vec<T>` lead on to what they hold.
        if T::output_path().is_some() {
            let docs = T::docs().unwrap_or_default();
            self.out.push(format!("{docs}export {}", T::decl(&self.cfg)));
        }
        T::visit_generics(self);
        T::visit_dependencies(self);
    }
}

/// Every type the client needs, as one TypeScript module.
pub fn typescript() -> String {
    let mut d = Declarations {
        // Payoffs and versions are i64/u64 but never pass 2^53.
        cfg: Config::new().with_large_int("number"),
        seen: HashSet::new(),
        out: Vec::new(),
    };
    d.visit::<ServerError>();
    let mut ts = String::from(HEADER);
    for decl in d.out {
        ts.push('\n');
        ts.push_str(&decl);
        ts.push('\n');
    }
    ts
}

/// Every generated file, by name within [`DIR`].
pub fn files() -> Vec<(&'static str, String)> {
    vec![("protocol.ts", typescript())]
}

/// Writes every generated file into `dir`.
pub fn write(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    for (name, contents) in files() {
        std::fs::write(dir.join(name), contents)?;
    }
    Ok(())
}

/// The generated files in `dir` that differ from what the server would
/// write now.
pub fn stale(dir: &Path) -> Vec<&'static str> {
    files()
        .into_iter()
        .filter(|(name, contents)| std::fs::read_to_string(dir.join(name)).ok().as_ref() != Some(contents))
        .map(|(name, _)| name)
        .collect()
}
