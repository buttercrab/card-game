// Generated from the server's Rust types (crates/server/src/codegen.rs).
// Do not edit: run `cargo run -p server -- --write-generated web/src/lib/generated`.

import type { Catalog } from './protocol';

export const CATALOG: Catalog = {
  "protocol": "96488eb9347b",
  "games": [
    {
      "id": "mighty",
      "name": "마이티"
    }
  ],
  "bot_levels": [
    {
      "id": "easy",
      "label": "초보"
    },
    {
      "id": "normal",
      "label": "보통"
    },
    {
      "id": "hard",
      "label": "고수"
    }
  ],
  "default_bot_level": "hard",
  "turn_limits": [
    0,
    20,
    40,
    60
  ],
  "reactions": [
    "👏",
    "😂",
    "😮",
    "😭",
    "🔥",
    "🙏",
    "나이스",
    "아…",
    "ㅋㅋㅋ",
    "빨리요~",
    "미안",
    "굿"
  ],
  "name_max": 24,
  "report_max": 2000,
  "report_days": 14,
  "idle_minutes": 30
};
