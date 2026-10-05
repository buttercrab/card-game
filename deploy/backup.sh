#!/usr/bin/env bash
# Copies the Seoul server's data directory (the stats log `stats.jsonl`,
# its salt, saved tables and problem reports) to the home server, keeping
# a dated archive a day for $keep_days days. A systemd timer
# (deploy/card-game-backup.timer) runs it daily. `docker cp` reads the
# volume through the container, which has no shell of its own.
#
# The archives hold players' names and the stats salt: they stay on the
# home server and never enter the repository. To restore one (the
# container's root is read-only, so a throwaway one writes the volume):
#
#   gunzip -c data-<stamp>.tar.gz | ssh cards-seoul \
#     'docker stop card-game && docker run --rm -i -v card-game_tables:/data alpine tar -x -C / && docker start card-game'
set -euo pipefail

seoul=cards-seoul
dest="${CARD_GAME_BACKUPS:-$HOME/backups/card-game}"
keep_days=30

mkdir -p "$dest"
chmod 700 "$dest"
stamp="$(date -u +%Y%m%d-%H%M%S)"
part="$dest/.data-$stamp.tar.gz.part"
trap 'rm -f "$part" "$part.list"' EXIT

ssh "$seoul" 'docker cp card-game:/data -' | gzip >"$part"
# A copy that cannot be listed, or lacks the stats log, is not a backup.
if ! tar -tzf "$part" >"$part.list" || ! grep -qx 'data/stats.jsonl' "$part.list"; then
  echo "backup from $seoul is incomplete; keeping the older ones" >&2
  exit 1
fi
mv "$part" "$dest/data-$stamp.tar.gz"
find "$dest" -maxdepth 1 -name 'data-*.tar.gz' -mtime +"$keep_days" -delete
echo "saved $dest/data-$stamp.tar.gz ($(du -h "$dest/data-$stamp.tar.gz" | cut -f1))"
