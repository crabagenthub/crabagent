# Agent 数据库表结构迁移（增量 DDL，见 internal/migrate/agent_tables.go）
# 使用：make migrate   或   ENV=prod make migrate
.PHONY: migrate resync-exec run
migrate:
	go run ./cmd/agent-migrate -env=$(or $(ENV),dev)

# 重跑 agent_exec_commands（全量或带 since-ms/until-ms），见 cmd/agent-exec-resync
resync-exec:
	go run ./cmd/agent-exec-resync -env=$(or $(ENV),dev)

# 启动 HTTP API（根目录 main.go）；使用：make run   或   ENV=prod make run
run:
	go run . -env=$(or $(ENV),dev)
