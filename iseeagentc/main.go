package main

import (
	"flag"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/tylerb/graceful"

	"iseeagentc/bootstrap"
	"iseeagentc/controller/router"
	"iseeagentc/internal/config"
	"iseeagentc/internal/logger"
	"iseeagentc/internal/validator"
)

var (
	// API 服务运行环境
	RunEnv         = flag.String("env", "dev", "app config file")
	RunAsScheduler = flag.Bool("schedule", false, "run as scheduler, will not setup http server")
)

func main() {
	// 解析命令行参数
	flag.Parse()

	log.Println("current use env : ", *RunEnv)

	// 初始化配置和服务
	err := bootstrap.ServiceInit(*RunEnv)
	if err != nil {
		log.Fatalf("bootstrap service init failed: %v", err)
	}

	// 初始化验证器
	validator.RegisterValidatorAndTrans()

	log.Println("所有服务初始化完成")

	// 启动HTTP服务器
	startHTTPServer()
}

func startHTTPServer() {
	// 创建Gin引擎
	apiHandler := gin.Default()
	router.Init(apiHandler)

	println("config.GetString(\"app.HTTPServer.Listen\")", config.GetString("app.HTTPServer.Listen"))

	// 创建HTTP服务器
	server := &graceful.Server{
		Timeout: 10 * time.Second,
		Server: &http.Server{
			Addr:    config.GetString("app.HTTPServer.Listen"),
			Handler: apiHandler,
		},
	}

	log.Printf("Starting HTTP server on %s", config.GetString("app.HTTPServer.Listen"))

	// 启动服务器（支持平滑重启）
	if err := server.ListenAndServe(); err != nil {
		log.Printf("HTTP server failed: %v", err)
	}

	// 服务器关闭时的清理工作
	log.Println("Shutting down server...")

	// 日志刷到磁盘
	if logger.Logger != nil {
		if err := logger.Logger.Sync(); err != nil {
			log.Printf("logger sync failed: %v", err)
		}
	}

	log.Println("Server shutdown complete")
}
