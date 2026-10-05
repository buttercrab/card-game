#!/usr/bin/env bash
# Puts back the image that ran before the last deploy, here (the bot
# worker) and in Seoul (cards.buttercrab.io). Run it again to undo. Run
# from the deploy checkout on the home server:
#
#   deploy/rollback.sh
#
# The rollback holds until main moves: deploy/update.sh deploys only a new
# green commit, so push the fix (or a revert) when ready. Tables saved by
# a newer server may not load in an older one; those are set aside as
# .bad files in the tables volume rather than lost.
set -euo pipefail

seoul=cards-seoul

cd "$(dirname "$0")/.."
bash deploy/seoul/images.sh rollback
docker compose -f deploy/compose.yaml up --detach --no-build --force-recreate --wait
scp -q deploy/seoul/images.sh "$seoul:card-game/"
ssh "$seoul" 'bash card-game/images.sh rollback && cd card-game && docker compose up --detach --force-recreate --wait cards'
echo "rolled back; run deploy/rollback.sh again to undo"
