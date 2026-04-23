package main

import (
	"flag"
	"log"

	"iseeagentc/bootstrap"
	"iseeagentc/internal/httpserver"
	"iseeagentc/internal/validator"
)

var (
	// API 服务运行环境
	RunEnv = flag.String("env", "dev", "app config file")
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

	httpserver.Start()
}
