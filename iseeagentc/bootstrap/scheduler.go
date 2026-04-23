package bootstrap

import (
	"database/sql"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"iseeagentc/internal/alerts"
	"iseeagentc/internal/resource"
)

// StartAlertScheduler starts the low-frequency alert evaluation ticker (backstop when ingest is idle).
// Reads CRAB_ALERT_SCHEDULER_EVERY (Go duration); empty = default 20m; 0 = disabled.
// Use from the HTTP process or from cmd/alert-scheduler for standalone deploy.
func StartAlertScheduler(db *sql.DB) {
	if db == nil {
		return
	}
	every := 20 * time.Minute
	if s := os.Getenv("CRAB_ALERT_SCHEDULER_EVERY"); s != "" {
		if s == "0" {
			return
		}
		if d, err := time.ParseDuration(s); err == nil {
			every = d
		}
	}
	alerts.StartScheduler(db, every)
}

// RunAlertSchedulerBlocking 在已执行 ServiceInit 后调用：取 Collector DB、启动周期补偿，阻塞至 SIGINT/SIGTERM。
// 与 StartAlertScheduler 搭配使用，供 cmd/alert-scheduler 与 crab alert-scheduler 复用。
func RunAlertSchedulerBlocking() {
	if resource.DB == nil {
		log.Fatal("alert-scheduler: resource.DB is nil (database not initialized)")
	}
	sqlDB, err := resource.DB.DB()
	if err != nil || sqlDB == nil {
		log.Fatalf("alert-scheduler: get *sql.DB: %v", err)
	}
	StartAlertScheduler(sqlDB)
	log.Println("alert-scheduler: started (backstop ticker); waiting for signal…")
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, os.Interrupt, syscall.SIGTERM)
	<-ch
	log.Println("alert-scheduler: exiting")
}
