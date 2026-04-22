#!/usr/bin/env bash
# 重跑历史数据写入 agent_exec_commands（全量或按 -since-ms / -until-ms 时间窗）。可重复执行。
# 示例：
#   ./scripts/agent-exec-resync.sh
#   ENV=prod ./scripts/agent-exec-resync.sh -since-ms=1710000000000 -until-ms=1710086400000
#   ./scripts/agent-exec-resync.sh -batch=200 -once
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export ENV="${ENV:-dev}"

exec go run ./cmd/agent-exec-resync -env="$ENV" "$@"
