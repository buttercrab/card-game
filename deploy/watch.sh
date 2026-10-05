#!/usr/bin/env bash
# Checks from outside that main reaches the site, for
# .github/workflows/deploy-watch.yaml. It opens an issue labelled `deploy`
# and assigns the owner (so GitHub notifies their phone) when
#
#   - the newest commit on main with green CI has not reached the site
#     $DEPLOY_GRACE_MIN minutes (default 40) after CI finished: a deploy
#     failed, or the home server is not deploying at all; or
#   - main's newest commit has waited on red or unfinished CI for
#     $BLOCKED_AFTER_MIN minutes (default 60): deploys are blocked;
#
# and closes it once the site serves main's newest green commit (or a
# later one) and nothing is blocked. The site reports its commit at
# /version. When the site does not answer at all, it does nothing: the
# uptime workflow opens its own issue for that.
#
# Needs gh (with GH_TOKEN: issues write, actions and contents read), curl
# and jq, and REPO (owner/name), OWNER (who to assign) and SITE (origin).
set -euo pipefail

repo="${REPO:?set REPO}"
owner="${OWNER:?set OWNER}"
site="${SITE:-https://cards.buttercrab.io}"
workflow=ci.yaml
grace_min="${DEPLOY_GRACE_MIN:-40}"
blocked_min="${BLOCKED_AFTER_MIN:-60}"
now="${NOW:-$(date +%s)}"
title="배포 문제: ${site#https://}"

epoch() {
  date -d "$1" +%s 2>/dev/null || date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$1" +%s
}

version="$(curl -fsS --max-time 15 "$site/version" 2>/dev/null || true)"
live="$(jq -r '.commit // empty' <<<"$version" 2>/dev/null || true)"
if [[ -z "$live" || "$live" == unknown ]]; then
  echo "$site/version names no commit; leaving it to the uptime workflow"
  exit 0
fi
worker="$(jq -r 'if .worker.connected then "연결됨 (\(.worker.commit // "?" | .[0:12]))" else "끊김" end' <<<"$version" 2>/dev/null || echo "?")"

head="$(gh api "repos/$repo/commits/main" --jq .sha)"
head_run="$(gh api "repos/$repo/actions/workflows/$workflow/runs?head_sha=$head&event=push&per_page=1" --jq '.workflow_runs[0] // empty')"
if [[ -n "$head_run" ]]; then
  head_state="$(jq -r 'if .status != "completed" then "진행 중" elif .conclusion == "success" then "success" else "실패" end' <<<"$head_run")"
  head_since="$(epoch "$(jq -r .created_at <<<"$head_run")")"
else
  head_state="없음"
  head_since="$(epoch "$(gh api "repos/$repo/commits/$head" --jq .commit.committer.date)")"
fi
green_run="$(gh api "repos/$repo/actions/workflows/$workflow/runs?branch=main&event=push&status=success&per_page=1" --jq '.workflow_runs[0] // empty')"
green=""
green_since="$now"
if [[ -n "$green_run" ]]; then
  green="$(jq -r .head_sha <<<"$green_run")"
  green_since="$(epoch "$(jq -r .updated_at <<<"$green_run")")"
fi

# Whether the site runs main's newest green commit, or one after it.
current=false
if [[ "$live" == "$head" || -z "$green" || "$live" == "$green" ]]; then
  current=true
else
  case "$(gh api "repos/$repo/compare/$green...$live" --jq .status 2>/dev/null || echo unknown)" in
    ahead | identical) current=true ;;
  esac
fi

problems=()
if [[ $current == false ]]; then
  waited=$(((now - green_since) / 60))
  if ((waited >= grace_min)); then
    problems+=("- **배포 실패**: CI를 통과한 \`${green:0:12}\`이 ${waited}분째 배포되지 않았어요.")
  fi
fi
if [[ "$head_state" != success ]]; then
  waited=$(((now - head_since) / 60))
  if ((waited >= blocked_min)); then
    problems+=("- **배포 막힘**: main의 \`${head:0:12}\`이 ${waited}분째 CI ${head_state} 상태라 배포를 기다리고 있어요.")
  fi
fi

echo "site ${live:0:12}, main ${head:0:12} (CI $head_state), newest green ${green:0:12}, current $current, worker $worker"
open="$(gh issue list -R "$repo" --label deploy --state open --json number -q '.[0].number')"
stamp="$(date -u +%H:%MZ)"
if ((${#problems[@]} == 0)); then
  if [[ $current == true && -n "$open" ]]; then
    gh issue close "$open" -R "$repo" -c "\`${live:0:12}\`이 배포됐어요 ($stamp)."
  fi
  exit 0
fi

printf '%s\n' "${problems[@]}"
if [[ -z "$open" ]]; then
  gh label create deploy --repo "$repo" --color B60205 --description "배포가 실패했거나 막혔어요" 2>/dev/null || true
  body="$(printf '%s\n' "${problems[@]}")

- 사이트: \`${live:0:12}\` ($site/version)
- 봇 워커: $worker
- main: \`${head:0:12}\` (CI $head_state)

홈 서버에서 \`journalctl --user -u card-game-update -n 100\`로 배포 로그를 보세요. 사이트가 main의 최신 초록 커밋을 내보내면 이 이슈는 자동으로 닫혀요 ($stamp)."
  gh issue create -R "$repo" --label deploy --assignee "$owner" --title "$title" --body "$body"
fi
exit 1
