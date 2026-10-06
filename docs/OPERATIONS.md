# Operations

This is the implemented deployment design and operating reference, not a
permanent live-state claim. Check running commits and services before acting.
Local development is in [DEVELOPMENT.md](DEVELOPMENT.md); open operational
acceptance gaps are in [FIXES.md](FIXES.md).

## Release boundary

Main auto-deploys after CI. Preparing a branch or PR does not authorize a
merge/release. Obtain release authority for the concrete revision; do not
bypass CI using update.sh's force/skip switches as a routine workflow.
Rollback/restart/install commands below change production and require the
appropriate authorization.

## Topology and deployment

The intended serving topology for [cards.buttercrab.io](https://cards.buttercrab.io) is on a small AWS
Lightsail instance in Seoul (`cards-seoul`), reached directly: through
Cloudflare's free plan, Korean ISPs are routed via Los Angeles (about
500 ms a round trip). The home server builds the image and runs the bot
worker that thinks for its bots.

[`Dockerfile`](../Dockerfile) builds the web client and the server into one
image serving port 3030. On the home server, a systemd timer runs
[`deploy/update.sh`](../deploy/update.sh) every two minutes: when `main`
is not what runs yet and its CI run is green, it builds the image, ships
it to Seoul, where [`deploy/seoul/`](../deploy/seoul) runs it behind Caddy
with an automatic certificate, checks that the site reports the new
commit at `/version`, and only then restarts the bot worker
([`deploy/compose.yaml`](../deploy/compose.yaml)) on the same image. The
deployed commit is kept in `~/.local/state/card-game/deployed`, written
only when both are up, so a failed build, ship or restart is tried again
(10 minutes later, then further apart, at most hourly); a new server that
does not come up healthy in Seoul is replaced by the one that ran before.
The bot worker and the server greet each other with a protocol version
and their build commits; a worker of another protocol is turned away and
shows on `/stats`, and tables think for themselves meanwhile. The
[`deploy-watch`](../.github/workflows/deploy-watch.yaml) workflow reads
`/version` every 15 minutes and opens an issue labelled `deploy`,
assigned to the owner, when main's newest green commit has not reached
the site 40 minutes after CI finished, or when main has waited on red or
unfinished CI for an hour; it closes the issue once the site catches up.
It runs on GitHub, so it also notices a home server that stopped
deploying, and the home server needs no token that can write. A failed
run of the update service also starts `card-game-update-failed.service`,
which logs it at error priority. `bash deploy/test/run.sh` (from the repository root) runs both
scripts against stand-ins for docker, ssh, curl and gh. On a stop signal the server saves
every table to its `tables` volume and the next start restores them, so a
deploy only drops connections for a moment; players see "잠깐 다시 연결하는
중" and get their seats back. The image that ran before stays as
`card-game:previous`, and [`deploy/rollback.sh`](../deploy/rollback.sh) puts
it back in both places (run it again to undo). A second timer runs
[`deploy/backup.sh`](../deploy/backup.sh) daily, keeping 30 days of the
Seoul data directory (stats log, tables, reports) on the home server.

```sh
docker build -t card-game .
docker run --rm -p 3030:3030 card-game   # http://localhost:3030
```

Caddy ([`deploy/seoul/Caddyfile`](../deploy/seoul/Caddyfile)) adds HSTS and
a Content Security Policy. The client needs a `blob:` worker (its
background timer), `blob:` images (the share card), its own fonts and
music, and Cloudflare's beacon; change the policy when the client starts
loading anything new. The server itself rate-limits table creation,
reports, client errors and WebSocket connects per client address; caps
open tables (`--max-rooms`, 500), request bodies, WebSocket message size
and each connection's message and hint rate; and runs at most two hint
searches at once. `/stats` shows open tables and the bot worker's link,
and the log warns when tables think with in-process bots instead.

### Stats and analytics

The server notes tables, seats, hands (finished or abandoned), reports and
client errors in `stats.jsonl` in its data directory: no cookies, IPs or
names, and players only as a salted hash of the id their browser keeps to
reclaim a seat. The salt is made on first run (`stats-salt`, next to the
log) unless `STATS_SALT` is set. The owner reads it at `/stats` (and as
JSON at `/api/stats`), which exist only when `STATS_TOKEN` is set: open
`/stats?token=<token>` once and a cookie keeps you in, or send
`Authorization: Bearer <token>`.

With `CF_BEACON_TOKEN` set, every page loads Cloudflare Web Analytics
(cookieless). On the Seoul instance both go in `~/card-game/site.env`,
which compose reads if present and which never enters the repository:

```sh
# on cards-seoul
cat > ~/card-game/site.env <<EOF
STATS_TOKEN=$(openssl rand -hex 32)
CF_BEACON_TOKEN=<token from Cloudflare: Analytics & Logs > Web Analytics > Add a site, "manual JS">
EOF
chmod 600 ~/card-game/site.env
cd ~/card-game && docker compose up --detach
```

Browsers report uncaught errors to `/api/errors`; `/stats` groups them by
message and top stack frame. Nothing is filed on GitHub: the repository is
public, and reports carry players' names and move logs.

## Verify a release

1. Read the public `/healthz` and `/version` endpoints. Compare the full
   server commit with the intended revision; check worker.connected and its
   commit/protocol. A healthy HTTP response alone does not prove worker parity.
2. Check the CI run for that revision and the update service logs/state on
   the deployment host. A merged PR alone is not a deploy receipt.
3. Exercise a table, bots and reconnect using an approved test table. Record
   the revision and outcome without publishing player logs.
4. On failure, diagnose before restarting; use the previous image only with
   rollback authority and verify the serving pair again.

## Backups and restoration

[backup.sh](../deploy/backup.sh) copies Seoul's data to the home server, keeps
30 days, and rejects an archive without the expected stats log. It contains
private player names/reports and the stats salt; keep it out of git.

This protects against loss on Seoul but leaves the backup on the home host.
Independent offsite copies and a recorded isolated restore test are open.
Listing a tar archive is not evidence that rooms can be restored. Do not
run the restore command in the script's comment against the live volume as
a test; design an isolated destination first.

## Evidence limits

At the 2026-10-06 takeover check, server and connected worker both reported
`4c4b8aa`, its CI was green, and deploy-watch/uptime passed. Remote logs,
backup contents, restoration and telemetry completeness were not inspected.
Refresh these checks for any later release.
