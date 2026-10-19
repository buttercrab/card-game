// Generated from the server's Rust types (crates/server/src/codegen.rs).
// Do not edit: run `cargo run -p server -- --write-generated web/src/lib/generated`.

import type { PokerCatalog } from '../protocol';

export const CATALOG: PokerCatalog = {
  "id": "poker",
  "name": "텍사스 홀덤",
  "presets": [
    {
      "id": "holdem",
      "name": "플레이칩 홀덤",
      "rules": {
        "players": 3,
        "starting_stack": 100
      }
    }
  ]
};
