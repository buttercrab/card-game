#!/usr/bin/env bash
# Shellchecks every shell script in the repository: tracked *.sh files and
# any other tracked file whose first line runs sh or bash (the stand-ins in
# deploy/test/bin, for one). CI runs it; so can you.
set -euo pipefail
cd "$(dirname "$0")/.."

scripts=()
while IFS= read -r -d '' file; do
    [[ -f $file ]] || continue
    if [[ $file == *.sh ]]; then
        scripts+=("$file")
        continue
    fi
    first=$(head -n 1 -- "$file" 2>/dev/null | tr -d '\0') || true
    if [[ $first =~ ^\#!.*[/\ ](ba|da)?sh([[:space:]]|$) ]]; then
        scripts+=("$file")
    fi
done < <(git ls-files -z)

echo "shellcheck: ${#scripts[@]} scripts"
shellcheck "$@" -- "${scripts[@]}"
