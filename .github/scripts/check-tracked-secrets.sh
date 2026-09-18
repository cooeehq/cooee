#!/usr/bin/env bash
set -euo pipefail

patterns=(
  '-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'
  'gh[pousr]_[A-Za-z0-9_]{36,}'
  'github_pat_[A-Za-z0-9_]{40,}'
  'sk_(live|test)_[A-Za-z0-9]{16,}'
  'whsec_[A-Za-z0-9]{16,}'
  'AKIA[0-9A-Z]{16}'
)

for pattern in "${patterns[@]}"; do
  if git grep -I -E -n -- "$pattern" -- \
    ':!*.lock' \
    ':!bun.lock' \
    ':!.github/scripts/check-tracked-secrets.sh'; then
    echo "A tracked file appears to contain a secret matching a known credential format." >&2
    exit 1
  fi
done
