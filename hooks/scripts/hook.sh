#!/bin/bash
# Fast hook wrapper — reads stdin, backgrounds the node CLI, exits immediately.
# Claude Code hooks block until the command exits. By backgrounding node and
# redirecting all file descriptors, bash exits in ~2-5ms instead of ~50-100ms.
#
# Guardrails: if node is missing or the CLI script is unreadable, append a
# breadcrumb to ~/.claude/logs/observe-hook.log so silent failures are
# discoverable. The wrapper still exits 0 so Claude Code does not block on
# hook failures, but the breadcrumb makes the issue findable.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$SCRIPT_DIR/observe_cli.mjs"
LOG_FILE="${AGENTS_OBSERVE_HOOK_LOG:-$HOME/.claude/logs/observe-hook.log}"

log_failure() {
  local reason="$1"
  mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null
  printf '[%s] hook.sh: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$reason" >> "$LOG_FILE" 2>/dev/null
}

if ! command -v node >/dev/null 2>&1; then
  log_failure "node not found in PATH"
  exit 0
fi

if [ ! -r "$CLI" ]; then
  log_failure "observe_cli.mjs missing or unreadable at $CLI"
  exit 0
fi

input=$(cat)
echo "$input" | node "$CLI" hook > /dev/null 2>&1 &
exit 0
