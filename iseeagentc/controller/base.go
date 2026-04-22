package controller

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"iseeagentc/internal/context"
	"iseeagentc/internal/errors"
	"iseeagentc/internal/logger"
)

/*
   Author : lucbine
   DateTime : 2024/4/25
   Description : 控制器通用方法
   Version : 1.0.0
*/

// 成功访问 200

func AbortWithResultAndStatus(c *gin.Context, code int, result interface{}) {
	requestId := context.GetRequestID(c)
	if result == nil {
		result = struct{}{}
	}
	body := map[string]interface{}{
		"code":       code,
		"message":    "",
		"result":     result,
		"request_id": requestId,
	}
	logger.Debug(c, "AbortWithResultAndStatus: ", zap.Any("result", body))
	c.JSON(http.StatusOK, body)
}

// 错误访问

func AbortWithWriteErrorResponse(c *gin.Context, err error) {
	if err == nil {
		return
	}
	logID := context.GetRequestID(c)
	var statusCode int
	var body interface{}
	switch e := err.(type) {
	case *errors.Error:
		if e.ChMessage != "" {
			e.Message = e.ChMessage
		}
		statusCode = e.HTTPStatus
		body = map[string]interface{}{
			"success": false,
			"code":    e.Code,
			"message": map[string]string{
				"global": e.Message,
			},
			"status": statusCode,
			"log_id": logID,
		}
	case *errors.NotFoundError:
		if e.ChMessage != "" {
			e.Message = e.ChMessage
		}
		statusCode = http.StatusNotFound
		body = map[string]interface{}{
			"success": false,
			"code":    e.Code,
			"status":  statusCode,
			"message": map[string]string{
				"global": e.Message,
			},
			"log_id": logID,
		}
	case *errors.NotAuthError:
		if e.ChMessage != "" {
			e.Message = e.ChMessage
		}
		statusCode = http.StatusUnauthorized
		body = map[string]interface{}{
			"success": false,
			"code":    e.Code,
			"status":  statusCode,
			"message": map[string]string{
				"global": e.Message,
			},
			"log_id": logID,
		}
	default:
		statusCode = http.StatusInternalServerError
		body = map[string]interface{}{
			"success": false,
			"code":    "InternalError",
			"status":  statusCode,
			"message": map[string]string{
				"global": err.Error(),
			},
			"log_id": logID,
		}
	}
	// logger.Debug(c, "AbortWithWriteErrorResponse: ", zap.String("result", utils.PrettyJson(body)))
	c.AbortWithStatusJSON(statusCode, body)
}

// 404 错误
func AbortWithURLNotFoundErrorResponse(c *gin.Context) {
	AbortWithWriteErrorResponse(c, errors.UrlNotFound())
}
