package router

/*
   Author : lucbine
   DateTime : 2024/4/25
   Description :
*/

import (
	"net/http"
	"reflect"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
	"go.uber.org/zap"

	"iseeagentc/controller"
	"iseeagentc/internal/logger"
	vd "iseeagentc/internal/validator"

	"iseeagentc/internal/errors"
)

/*
   Author : lucbine
   DateTime : 2024/4/25
   Description : 控制器通用方法
   Version : 1.0.0
*/

//定义 http 请求处理函数

type TypedHandler[T any] func(c *gin.Context, req *T)

func GetTypedHandler[T any](h TypedHandler[T]) func(*gin.Context) {
	return func(c *gin.Context) {
		// GET/HEAD 无 body（ContentLength=0）是常态，必须走 query 绑定；不可当成「无请求体」传 nil。
		if c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead {
			req, err := GetBindRequest[T](c)
			if err != nil {
				logger.Error(c, "Bind request failed: ", zap.Any("query", c.Request.URL.Query()), zap.Error(err))
				controller.AbortWithWriteErrorResponse(c, err)
				return
			}
			h(c, req)
			return
		}

		if c.Request.ContentLength == 0 || c.Request.Body == http.NoBody {
			h(c, nil)
			return
		}

		req, err := GetBindRequest[T](c)
		if err != nil {
			logger.Error(c, "Bind request failed: ", zap.Any("params", c.Request.PostForm), zap.Error(err))
			controller.AbortWithWriteErrorResponse(c, err)
			return
		}
		h(c, req)
	}
}

// 绑定请求参数到结构体

func GetBindRequest[T any](c *gin.Context) (*T, error) {
	var req T
	// GET请求只绑定query, 如果绑定json而没有传body的时候会报EOF错误
	if c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead {
		// 先尝试绑定query参数
		if err := c.ShouldBindQuery(&req); err != nil {
			return nil, handleValidationError(err, &req)
		}
		return &req, nil
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		return nil, handleValidationError(err, &req)
	}
	// 尝试绑定query参数
	if err := c.ShouldBindQuery(&req); err != nil {
		return nil, handleValidationError(err, &req)
	}

	return &req, nil
}

func handleValidationError[T any](err error, obj T) error {
	if err == nil {
		return nil
	}
	// 获取结构体类型
	o := reflect.TypeOf(obj)
	switch typeErr := err.(type) {
	case validator.FieldError:
		// 根据报错字段名，获取结构体的具体字段
		if f, exits := o.Elem().FieldByName(typeErr.Field()); exits {
			msg := f.Tag.Get("msg")
			return errors.ParamFieldError(f.Tag.Get("json"), msg)
		}
		return errors.ParamFieldError(typeErr.Field(), typeErr.Translate(vd.DefaultTranslator))
	case validator.ValidationErrors:
		if len(typeErr) == 0 {
			return nil
		}
		if f, exits := o.Elem().FieldByName(typeErr[0].Field()); exits {
			msg := f.Tag.Get("msg")
			return errors.ParamFieldError(f.Tag.Get("json"), msg)
		}
		return errors.ParamFieldError(typeErr[0].Field(), typeErr[0].Translate(vd.DefaultTranslator))
	default:
		return err
	}
}
