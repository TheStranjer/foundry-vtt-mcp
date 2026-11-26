#!/usr/bin/env bash
# scripts/ci.sh — the whole gate in one command: ESLint, the TypeScript
# build and the Jest suite. .github/workflows/ci.yml runs this same script,
# so a clean run here is a green pipeline there. Dependencies must already
# be installed (`npm ci`).
#
# Every check runs even after another has failed, so one pass reports
# everything that is broken.
#
# The output is terse: no news is good news. Each check's output is
# captured. A passing check prints nothing, unless its output has warning
# lines, which are printed alone. A failing check prints its whole output,
# without colour codes, the repository path prefix, blank lines or the
# names of Jest files that passed. A fully green run prints nothing at all.
#
# The exit status is explicit: 0 when every check passed, 1 otherwise.

set -uo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(dirname -- "$script_dir")"
cd "$repo_root" || exit 1

export NO_COLOR=1 FORCE_COLOR=0

log_dir="$(mktemp -d)"
trap 'rm -rf -- "$log_dir"' EXIT

failed_checks=()

# clean LOG — print LOG without colour codes, carriage returns, the absolute
# repository path, blank lines or Jest's per-file PASS lines.
clean() {
  sed -E \
    -e 's/\x1b\[[0-9;?]*[[:alpha:]]//g' \
    -e 's/\r//g' \
    -e "s|${repo_root}/||g" \
    -e '/^[[:space:]]*$/d' \
    -e '/^PASS /d' \
    "$1"
}

# step LABEL COMMAND... — run the command with its output captured. On
# success print only its warning lines, if any; on failure print all of its
# output and remember the label.
step() {
  local label="$1" log warnings
  shift
  log="$log_dir/${label//[^[:alnum:]]/-}.log"
  if "$@" >"$log" 2>&1; then
    warnings="$(clean "$log" | grep -iE '(^|[^[:alpha:]])(warn|deprecat)')"
    if [[ -n "$warnings" ]]; then
      printf '== %s: warnings\n%s\n' "$label" "$warnings"
    fi
    return 0
  fi
  failed_checks+=("$label")
  printf '== %s: FAILED\n' "$label"
  clean "$log"
  return 1
}

step 'ESLint' npx --no-install eslint .
step 'TypeScript build' npx --no-install tsc --pretty false
step 'Jest' npx --no-install jest --ci --silent

if ((${#failed_checks[@]} == 0)); then
  exit 0
fi

printf 'FAILED:'
printf ' [%s]' "${failed_checks[@]}"
printf '\n'
exit 1
