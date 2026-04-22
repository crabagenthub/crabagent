package context

import (
	"net"

	"github.com/gin-gonic/gin"

	"iseeagentc/internal/config"
)

/*
Author : lucbine
DateTime : 2024/4/25
Description : 上下文
*/

type AppContext struct {
	RequestID    string // 请求ID，转发过来的请求从header:X-Request-Id中读取，其他请求自动生成
	FromPlatform string // 当前请求的来源平台（不区分公有云、私有化
	UserID       uint64 // 用户唯一 id
	Email        string
	Phone        string
	IP           net.IP // 客户端IP
}

// GetAppContext 获取应用上下文，返回的一定是非nil
func GetAppContext(c *gin.Context) *AppContext {
	appCtxValue := c.Value(config.AppName())
	if appCtxValue != nil {
		return appCtxValue.(*AppContext)
	}
	return &AppContext{}
}

// SetAppContext 设置：有很多中间件会先于user-login-aibase读写appCtx，在这些中间件之前，bmlCtx里面是没有内容的
func SetAppContext(c *gin.Context, appCtx *AppContext) {
	c.Set(config.AppName(), appCtx)
}

// GetRequestID 获取请求ID
func GetRequestID(c *gin.Context) string {
	appCtx := GetAppContext(c)
	return appCtx.RequestID
}

func GetUserID(c *gin.Context) (uint64, error) {
	appCtx := GetAppContext(c)
	return appCtx.UserID, nil
}
