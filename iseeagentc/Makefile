# Agent 数据库表结构迁移（增量 DDL，见 internal/migrate/agent_tables.go）
# 统一 CLI：go run ./cmd/crab <command>（见 cmd/crab/main.go）
# 使用：make migrate   或   ENV=prod make migrate
.PHONY: migrate resync-exec run alert-scheduler build-crab crab-server crab-alert-scheduler crab-migrate crab-exec-resync
migrate:
	go run ./cmd/agent-migrate -env=$(or $(ENV),dev)

# 重跑 agent_exec_commands（全量或带 since-ms/until-ms），见 cmd/agent-exec-resync
resync-exec:
	go run ./cmd/agent-exec-resync -env=$(or $(ENV),dev)

# 启动 HTTP API（根目录 main.go）；使用：make run   或   ENV=prod make run
run:
	go run . -env=$(or $(ENV),dev)

# 仅启动告警周期补偿（cmd/alert-scheduler，不监听 HTTP）。
# 与 API 分进程部署时，在 API 进程上设置 CRAB_DISABLE_EMBEDDED_ALERT_SCHEDULER=1 避免双跑。
# 使用：make alert-scheduler   或   ENV=prod make alert-scheduler
alert-scheduler:
	go run ./cmd/alert-scheduler -env=$(or $(ENV),dev)

# 编译统一入口为当前目录可执行文件 ./crab
build-crab:
	go build -o crab ./cmd/crab

# 以下等同各子命令的 go run ./cmd/...，经 crab 子命令包装
crab-server:
	go run ./cmd/crab server -env=$(or $(ENV),dev)

crab-alert-scheduler:
	go run ./cmd/crab alert-scheduler -env=$(or $(ENV),dev)

crab-migrate:
	go run ./cmd/crab migrate -env=$(or $(ENV),dev)

crab-exec-resync:
	go run ./cmd/crab exec-resync -env=$(or $(ENV),dev)
