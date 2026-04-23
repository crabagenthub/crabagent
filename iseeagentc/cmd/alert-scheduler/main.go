// alert-scheduler 仅启动 Collector DB 与告警周期补偿任务，不监听 HTTP。
// 与 API 进程分离部署时，在 API 侧设置 CRAB_DISABLE_EMBEDDED_ALERT_SCHEDULER=1，避免与内嵌定时器重复评估。
// 等价命令：crab alert-scheduler -env=<env>
package main

import (
	"flag"
	"log"

	"iseeagentc/bootstrap"
)

func main() {
	env := flag.String("env", "dev", "app config directory under conf/ (e.g. dev, prod)")
	flag.Parse()
	if err := bootstrap.ServiceInit(*env); err != nil {
		log.Fatalf("bootstrap: %v", err)
	}
	bootstrap.RunAlertSchedulerBlocking()
}
