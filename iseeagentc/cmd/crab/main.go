// crab 统一子命令入口，可替代分别执行根目录 main、cmd/alert-scheduler、cmd/agent-migrate、cmd/agent-exec-resync。
//
//	./crab server -env=dev
//	./crab alert-scheduler -env=dev
//	./crab migrate -env=dev
//	./crab exec-resync -env=dev -since-ms=0
//
// 构建：go build -o crab ./cmd/crab
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"iseeagentc/bootstrap"
	"iseeagentc/internal/cmdtasks"
	"iseeagentc/internal/httpserver"
	"iseeagentc/internal/validator"
)

func main() {
	log.SetFlags(log.LstdFlags)
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	cmd := os.Args[1]
	if cmd == "-h" || cmd == "--help" || cmd == "help" {
		usage()
		return
	}
	args := os.Args[2:]

	switch cmd {
	case "server":
		runServer(args)
	case "alert-scheduler":
		runAlertScheduler(args)
	case "migrate":
		runMigrate(args)
	case "exec-resync":
		runExecResync(args)
	default:
		fmt.Fprintf(os.Stderr, "crab: unknown command %q\n\n", cmd)
		usage()
		os.Exit(2)
	}
}

func runServer(args []string) {
	fs := flag.NewFlagSet("server", flag.ExitOnError)
	env := fs.String("env", "dev", "配置环境 conf/<env>，如 dev、prod")
	fs.Usage = func() {
		fmt.Fprintf(fs.Output(), "Usage: crab server [flags]\n")
		fs.PrintDefaults()
	}
	_ = fs.Parse(args)
	log.Println("current use env:", *env)
	if err := bootstrap.ServiceInit(*env); err != nil {
		log.Fatalf("bootstrap service init failed: %v", err)
	}
	validator.RegisterValidatorAndTrans()
	log.Println("所有服务初始化完成")
	httpserver.Start()
}

func runAlertScheduler(args []string) {
	fs := flag.NewFlagSet("alert-scheduler", flag.ExitOnError)
	env := fs.String("env", "dev", "配置环境 conf/<env>")
	_ = fs.Parse(args)
	if err := bootstrap.ServiceInit(*env); err != nil {
		log.Fatalf("bootstrap: %v", err)
	}
	bootstrap.RunAlertSchedulerBlocking()
}

func runMigrate(args []string) {
	fs := flag.NewFlagSet("migrate", flag.ExitOnError)
	env := fs.String("env", "dev", "配置环境 conf/<env>")
	timeout := fs.Duration("timeout", 45*time.Second, "连接与迁移总超时")
	_ = fs.Parse(args)
	if err := cmdtasks.RunAgentMigrate(*env, *timeout); err != nil {
		log.Printf("migrate failed: %v", err)
		os.Exit(1)
	}
	log.Println("agent schema migration: ok")
}

func runExecResync(args []string) {
	fs := flag.NewFlagSet("exec-resync", flag.ExitOnError)
	env := fs.String("env", "dev", "配置环境 conf/<env>")
	sinceMs := fs.Int64("since-ms", 0, "仅重跑该毫秒时间戳之后（含）的 span；0 不限制")
	untilMs := fs.Int64("until-ms", 0, "仅重跑该毫秒时间戳之前（含）的 span；0 不限制")
	batch := fs.Int("batch", 400, "每事务批大小")
	once := fs.Bool("once", false, "只跑一批后退出")
	maxRows := fs.Int("max-rows", 0, "累计 UPSERT 上限，0 不限制")
	_ = fs.Parse(args)
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

func usage() {
	const text = `crab — Agent 与告警相关任务

Usage:
  crab <command> [flags]

Commands:
  server            启动 HTTP API（等同根目录 go run .）
  alert-scheduler   仅告警周期补偿，不监听 HTTP；API 分进程时设 CRAB_DISABLE_EMBEDDED_ALERT_SCHEDULER=1
  migrate           Agent 表结构迁移（与 cmd/agent-migrate 相同）
  exec-resync      重算 agent_exec_commands（与 cmd/agent-exec-resync 相同）

Examples:
  crab server -env=dev
  crab alert-scheduler -env=prod
  crab migrate -env=dev
  crab exec-resync -env=dev -since-ms=1710000000000
`
	fmt.Fprint(os.Stdout, text)
}
