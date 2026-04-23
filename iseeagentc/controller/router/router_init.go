package router

import (
	"os"

	"github.com/gin-gonic/gin"

	"iseeagentc/bootstrap"
	"iseeagentc/controller"
	"iseeagentc/controller/middleware"
	"iseeagentc/internal/alerts"
	"iseeagentc/internal/ingest"
	"iseeagentc/internal/resource"
)

/*
   Author : lucbine
   DateTime : 2024/3/4
   Description :
*/

const (
	NoAuthGroup = "no_auth"
)

func Init(r *gin.Engine) {
	// 根路径：本服务为 API，无静态首页；避免直接访问 / 时出现 404 被误认为服务未启动。

	// r.GET("/", controller.AbortWithNotFoundErrorResponse)
	r.GET("/health", controller.Health)

	// 初始化通用中间件
	r.Use(middleware.RequestID())
	r.Use(middleware.CollectorBrowserCORS())

	// 用户中心等
	RegisterUser(r)

	// Trace 观测相关
	RegisterTrace(r)

	// 告警主路径在收集器 ApplyOpikBatch 入库成功后经 alerts.OnIngestWorkspaces 触发（ingest 通过回调避免与 model 循环依赖）。
	// 周期任务为低频补偿（长窗口/无新数据时）。用 CRAB_ALERT_SCHEDULER_EVERY=0 可关闭，或 Go duration 如 30m（默认 20m）。
	ingest.RegisterAfterOpikCommitIngest(alerts.OnIngestWorkspaces)
	// 独立部署 alert-scheduler 时设 CRAB_DISABLE_EMBEDDED_ALERT_SCHEDULER=1，避免与 API 内嵌定时器双跑。
	if os.Getenv("CRAB_DISABLE_EMBEDDED_ALERT_SCHEDULER") != "1" && resource.DB != nil {
		if db, err := resource.DB.DB(); err == nil && db != nil {
			bootstrap.StartAlertScheduler(db)
		}
	}

	// 404 错误
	r.NoRoute(controller.AbortWithURLNotFoundErrorResponse)
}
