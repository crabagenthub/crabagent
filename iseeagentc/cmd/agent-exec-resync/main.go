// agent-exec-resync：从 agent_spans 按 Shell 规则重算并 UPSERT agent_exec_commands（全量或按时间窗），可重复执行。
//
// 用法示例：
//
//	go run ./cmd/agent-exec-resync -env=dev
//	go run ./cmd/agent-exec-resync -env=dev -since-ms=1710000000000 -until-ms=1711000000000
//	go run ./cmd/agent-exec-resync -env=dev -batch=200 -once
//	go run ./cmd/agent-exec-resync -env=dev -max-rows=5000
//
// 长时间任务可用系统工具：timeout 2h go run ./cmd/agent-exec-resync -env=dev
//
// 或：./scripts/agent-exec-resync.sh
//
// 依赖与主服务相同：conf/<env>、personal 模式 SQLite / enterprise 模式 PostgreSQL（bootstrap.ServiceInit）。
package main

import (
	"flag"
	"log"
	"os"

	"iseeagentc/bootstrap"
	"iseeagentc/internal/config"
	"iseeagentc/internal/resource"
	"iseeagentc/model"
)

func main() {
	env := flag.String("env", "dev", "配置环境 conf/<env>")
	sinceMs := flag.Int64("since-ms", 0, "仅重跑该毫秒时间戳之后（含）的 span；0 表示不限制")
	untilMs := flag.Int64("until-ms", 0, "仅重跑该毫秒时间戳之前（含）的 span；0 表示不限制")
	batch := flag.Int("batch", 400, "每事务批大小")
	once := flag.Bool("once", false, "只跑一批后退出（试跑）")
	maxRows := flag.Int("max-rows", 0, "累计 UPSERT 上限，0 不限制")
	flag.Parse()

	if err := bootstrap.ServiceInit(*env); err != nil {
		log.Fatalf("bootstrap: %v", err)
	}
	if config.IsCollectorPersonalMode() {
		cc := config.NewCollectorProxyConfig()
		log.Printf("collector: %s", config.CollectorConfigSummary(cc))
	} else {
		log.Printf("collector: enterprise (PostgreSQL)")
	}
	gdb := resource.DB
	if gdb == nil {
		log.Fatal("database not initialized (check collector mode / config)")
	}
	sqlDB, err := gdb.DB()
	if err != nil {
		log.Fatalf("sql.DB: %v", err)
	}
	if all, shell, execN, err := model.ExecCommandsResyncDiagnostics(sqlDB); err != nil {
		log.Printf("diagnostics: %v", err)
	} else {
		log.Printf("before resync: agent_spans=%d shell_like_tool_spans=%d agent_exec_commands=%d (shell_like 为 0 则不会写入任何行)",
			all, shell, execN)
	}

	opts := model.ResyncExecCommandsOptions{
		Batch:   *batch,
		Once:    *once,
		MaxRows: *maxRows,
	}
	if *sinceMs > 0 {
		v := *sinceMs
		opts.SinceMs = &v
	}
	if *untilMs > 0 {
		v := *untilMs
		opts.UntilMs = &v
	}

	total, err := model.ResyncAgentExecCommands(sqlDB, opts)
	if err != nil {
		log.Printf("resync error: %v", err)
		os.Exit(1)
	}
	if all, shell, execN, err := model.ExecCommandsResyncDiagnostics(sqlDB); err != nil {
		log.Printf("after diagnostics: %v", err)
	} else {
		log.Printf("after resync: agent_spans=%d shell_like_tool_spans=%d agent_exec_commands=%d", all, shell, execN)
	}
	log.Printf("agent_exec_commands resync done: upserted=%d since_ms=%d until_ms=%d batch=%d once=%v max_rows=%d",
		total, *sinceMs, *untilMs, *batch, *once, *maxRows)
}
