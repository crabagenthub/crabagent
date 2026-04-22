// agent-migrate 仅加载配置并执行 Agent 库表结构迁移（internal/migrate.RunAgentTableMigrations），
// 不启动 HTTP、不初始化 Redis/ClickHouse。今后在 agent_tables.go 等增加 DDL 后，可跑本命令或本目录下 scripts/agent-db-migrate.sh。
package main

import (
	"context"
	"flag"
	"log"
	"os"
	"time"

	"iseeagentc/internal/config"
	"iseeagentc/internal/resource"
)

func main() {
	env := flag.String("env", "dev", "配置环境，对应 conf/<env> 目录（如 dev、business、prod）")
	timeout := flag.Duration("timeout", 45*time.Second, "连接与迁移过程总超时")
	flag.Parse()

	config.Parse(*env)

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	if err := resource.RunAgentSchemaMigrations(ctx); err != nil {
		log.Printf("migrate failed: %v", err)
		os.Exit(1)
	}
	log.Println("agent schema migration: ok")
}
