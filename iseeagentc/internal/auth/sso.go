package auth

import (
	"errors"
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"

	"iseeagentc/internal/resource"
)

/*
   Author : lucbine
   DateTime : 2024/4/26
   Description : sso 认证
*/

const (
	SsoUserKey = "sso_user:+%d"
)

// IsLogin 判断用户是已经登陆
func IsLogin(c *gin.Context, userID uint64) (bool, error) {
	if resource.Redis == nil {
		// personal 模式下默认不初始化 Redis，降级为不启用单点登录
		return false, nil
	}
	key := fmt.Sprintf(SsoUserKey, userID)
	token, err := resource.Redis.Get(c, key).Result()

	fmt.Println("token:", token, "err", err)

	if err != nil && !errors.Is(err, redis.Nil) {
		return false, err
	}
	if token == "" {
		return false, nil
	}
	return true, nil
}

// SetLogin 保存用户登陆信息
func SetLogin(c *gin.Context, userID uint64) error {
	if resource.Redis == nil {
		// personal 模式下默认不初始化 Redis，跳过单点登录状态写入
		return nil
	}
	key := fmt.Sprintf(SsoUserKey, userID)
	_, err := resource.Redis.Set(c, key, 1, -1).Result()
	if err != nil {
		return err
	}
	return nil
}
