package router

import (
	"github.com/gin-gonic/gin"

	"iseeagentc/controller"
	"iseeagentc/controller/middleware"
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

	// 404 错误
	r.NoRoute(controller.AbortWithURLNotFoundErrorResponse)
}
