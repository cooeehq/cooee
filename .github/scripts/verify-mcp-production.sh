#!/usr/bin/env bash

set -euo pipefail

mcp_port="${MCP_SMOKE_PORT:-3101}"
mcp_log="$(mktemp)"
mcp_pid=""

cleanup() {
  if [[ -n "$mcp_pid" ]] && kill -0 "$mcp_pid" 2>/dev/null; then
    kill "$mcp_pid"
    wait "$mcp_pid" 2>/dev/null || true
  fi
  rm -f "$mcp_log"
}
trap cleanup EXIT

COOEE_API_BASE_URL=http://localhost:3000 \
MCP_URL="http://localhost:$mcp_port" \
NODE_ENV=production \
PORT="$mcp_port" \
bun run --cwd apps/mcp start >"$mcp_log" 2>&1 &
mcp_pid="$!"

for _attempt in {1..40}; do
  if curl --fail --silent "http://localhost:$mcp_port/health" \
    | grep --quiet '"service":"cooee-mcp"'; then
    echo "MCP production artifact passed its health check on port $mcp_port."
    exit 0
  fi

  if ! kill -0 "$mcp_pid" 2>/dev/null; then
    cat "$mcp_log"
    exit 1
  fi

  sleep 0.25
done

cat "$mcp_log"
echo "MCP production artifact did not become healthy." >&2
exit 1
