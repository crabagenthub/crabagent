package resource

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"

	"iseeagentc/internal/config"
)

/*
   Author : lucbine
   DateTime : 2024/4/25
   Description :
*/

//var Redis *gorm.DB

var Redis *redis.Client

func InitRedis() {
	// 初始化redis连接
	redisKey := "redis.Conn."

	rdb := redis.NewClient(&redis.Options{
		Addr:        fmt.Sprintf("%s:%s", config.GetString(redisKey+"Host"), config.GetString(redisKey+"Port")),
		Password:    config.GetString(redisKey + "Password"), // no password set
		DB:          config.GetInt(redisKey + "DB"),          // use default DB
		DialTimeout: 5 * time.Second,
		ReadTimeout: 5 * time.Second,
		//ReadTimeout:  time.Duration(config.GetInt(redisKey+"ReadTimeOut")) * time.Microsecond,
		//WriteTimeout: time.Duration(config.GetInt(redisKey+"WriteTimeOut")) * time.Microsecond,
		//DialTimeout:  time.Duration(config.GetInt(redisKey+"ConnTimeOut")) * time.Microsecond,
		//MaxRetries:   config.GetInt(redisKey + "MaxRetries"),
		//PoolSize:     config.GetInt(redisKey + "PoolSize"),
		//MinIdleConns: config.GetInt(redisKey + "MinIdleConns"),
	})

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if _, err := rdb.Ping(ctx).Result(); err != nil {
		panic(fmt.Errorf("redis ping: %w", err))
	}
	Redis = rdb
}
