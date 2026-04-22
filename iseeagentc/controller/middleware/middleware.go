package middleware

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"iseeagentc/controller"
	"iseeagentc/internal/auth"
	"iseeagentc/internal/context"
	"iseeagentc/internal/errors"
	"iseeagentc/utils"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

const HeaderXBceRequestID = ""

// CheckAuth 检查是否登陆
func CheckAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 从请求头中获取 Authorization 头部  格式 aToken,rToken
		authorization := c.GetHeader("Authorization")
		if authorization == "" {
			controller.AbortWithWriteErrorResponse(c, errors.AuthFail("您未登陆"))
			return
		}
		tokens := strings.Split(authorization, ",")
		if len(tokens) < 2 {
			controller.AbortWithWriteErrorResponse(c, errors.AuthFail("您未登陆"))
			return
		}

		aToken := tokens[0]
		rToken := tokens[1]

		if aToken == "" || rToken == "" {
			controller.AbortWithWriteErrorResponse(c, errors.AuthFail("您未登陆"))
			return
		}

		//token 校验
		mc, err := auth.ValidAccessToken(aToken)

		//因为 token 过期 ，可以进入到 refreshToken 进行判断
		if errors.Is(err, jwt.ErrTokenExpired) {
			//如果解析失败，可能是因为 token 过期 ，可以进入到 refreshToken 进行判断
			newAToken, newRToken, err := auth.RefreshToken(aToken, rToken)
			if err != nil {
				controller.AbortWithWriteErrorResponse(c, err)
				return
			}
			//将新 token 返还给前端
			c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
			c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, PUT, OPTIONS")
			c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			c.Writer.Header().Set("newToken", fmt.Sprintf("%s,%s", newAToken, newRToken))
			c.Next()
			return
		} else if err != nil {
			controller.AbortWithWriteErrorResponse(c, errors.AuthFail(err.Error()))
			return
		}

		//传递到 context 中
		appCtx := context.GetAppContext(c)
		appCtx.UserID = mc.UserID
		appCtx.Phone = mc.Phone
		appCtx.Email = mc.Email
		context.SetAppContext(c, appCtx)
		c.Next()
	}
}

// CollectorBrowserCORS 允许本机 Next（localhost / 127.0.0.1 / ::1 任意端口）直连 iseeagentc，避免必须走 /api/collector 代理。
func CollectorBrowserCORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := strings.TrimSpace(c.GetHeader("Origin"))
		if origin != "" && isLoopbackWebOrigin(origin) {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Api-Key, X-API-Key, Accept")
			c.Header("Access-Control-Max-Age", "86400")
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func isLoopbackWebOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	h := strings.ToLower(strings.TrimSpace(u.Hostname()))
	return h == "localhost" || h == "127.0.0.1" || h == "::1"
}

func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := c.GetHeader(HeaderXBceRequestID)
		if requestID == "" {
			requestID = utils.GenUUID()
		}

		// 写入appCtx
		appCtx := context.GetAppContext(c)
		appCtx.RequestID = requestID
		context.SetAppContext(c, appCtx)
		c.Next()
	}
}
