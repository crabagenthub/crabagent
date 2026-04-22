#!/usr/bin/env bash
# 在 iseeagentc 目录下执行 Agent 库 DDL 迁移（与启动服务时 InitSQLite/InitPostgreSQL 内逻辑一致）。
# 用法：
#   ./scripts/agent-db-migrate.sh              # ENV=dev
#   ENV=prod ./scripts/agent-db-migrate.sh   # conf/prod
# 额外参数传给 go run，例如：./scripts/agent-db-migrate.sh -timeout=2m
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export ENV="${ENV:-dev}"

exec go run ./cmd/agent-migrate -env="$ENV" "$@"
