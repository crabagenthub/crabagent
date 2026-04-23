// agent-migrate 仅加载配置并执行 Agent 库表结构迁移，不启动 HTTP、不初始化 Redis/ClickHouse。
// 等价命令：crab migrate -env=<env>
package main

import (
	"flag"
	"log"
	"os"
	"time"

	"iseeagentc/internal/cmdtasks"
)

func main() {
	env := flag.String("env", "dev", "配置环境，对应 conf/<env> 目录（如 dev、business、prod）")
	timeout := flag.Duration("timeout", 45*time.Second, "连接与迁移过程总超时")
	flag.Parse()

	if err := cmdtasks.RunAgentMigrate(*env, *timeout); err != nil {
		log.Printf("migrate failed: %v", err)
		os.Exit(1)
	}
	log.Println("agent schema migration: ok")
}
