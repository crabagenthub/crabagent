// agent-exec-resync：从 agent_spans 按 Shell 规则重算并 UPSERT agent_exec_commands（全量或按时间窗），可重复执行。
// 等价命令：crab exec-resync [flags]
//
// 依赖与主服务相同：conf/<env>、personal 模式 SQLite / enterprise 模式 PostgreSQL（bootstrap.ServiceInit）。
package main

import (
	"flag"
	"log"
	"os"

	"iseeagentc/internal/cmdtasks"
)

func main() {
	env := flag.String("env", "dev", "配置环境 conf/<env>")
	sinceMs := flag.Int64("since-ms", 0, "仅重跑该毫秒时间戳之后（含）的 span；0 表示不限制")
	untilMs := flag.Int64("until-ms", 0, "仅重跑该毫秒时间戳之前（含）的 span；0 表示不限制")
	batch := flag.Int("batch", 400, "每事务批大小")
	once := flag.Bool("once", false, "只跑一批后退出（试跑）")
	maxRows := flag.Int("max-rows", 0, "累计 UPSERT 上限，0 不限制")
	flag.Parse()

	_, err := cmdtasks.RunExecResync(cmdtasks.ExecResyncOptions{
		Env:     *env,
		SinceMs: *sinceMs,
		UntilMs: *untilMs,
		Batch:   *batch,
		Once:    *once,
		MaxRows: *maxRows,
	})
	if err != nil {
		log.Printf("resync error: %v", err)
		os.Exit(1)
	}
}
