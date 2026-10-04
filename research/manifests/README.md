# Manifests

Self-play shards and model weights are too large for git. They live in an
artifact store outside the repository; a manifest here, one JSON file per
artifact set, says exactly what they are:

| Field | Meaning |
| --- | --- |
| `name` | Unique among manifests |
| `kind` | `self-play`, `weights`, `eval` or `other` |
| `created` | Date, `YYYY-MM-DD` |
| `commit` | Full hash of the commit that produced it |
| `config` | Path in the repository of the producing config |
| `seeds` | Every seed the run used |
| `encoding` | Encoding spec version (such as `mighty-1`), or `null` |
| `artifacts` | Each file: `path` (relative to the store), `bytes`, `sha256` |

The schema is `cardgame_ml.manifest.Manifest` in [`ml/`](../../ml); its
tests load every manifest committed here, so a malformed one fails CI.
`Manifest.verify(root)` checks files in a store against their record.
