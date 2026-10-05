//! The web client's generated files match the server's types. After a
//! change to the protocol, rewrite them with
//! `cargo run -p server -- --write-generated web/src/lib/generated`
//! (or run this test with `UPDATE_GENERATED=1`).

use server::codegen;
use std::path::PathBuf;

#[test]
fn the_web_clients_generated_files_are_current() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(codegen::DIR);
    if std::env::var_os("UPDATE_GENERATED").is_some() {
        codegen::write(&dir).unwrap();
    }
    let stale = codegen::stale(&dir);
    assert!(
        stale.is_empty(),
        "stale in {}: {stale:?}; run `cargo run -p server -- --write-generated {}`",
        codegen::DIR,
        codegen::DIR
    );
}
