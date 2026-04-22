package bootstrap

import (
	"log"
	"sync"

	"iseeagentc/internal/config"
	"iseeagentc/internal/logger"
	"iseeagentc/internal/resource"
)

var (
	initOnce sync.Once
	initDone bool
)

// 解析配置文件
func ServiceInit(runEnv string) error {
	// 解析配置文件
	config.Parse(runEnv)

	// 设置配置变化回调
	config.SetConfigChangeCallback(OnConfigChange)

	// 启动配置监控
	if err := config.StartWatch(); err != nil {
		log.Printf("启动配置监控失败: %v", err)
		// 不返回错误，允许程序继续运行
	}

	// 初始化服务
	MustInit()

	return nil
}

func MustInit() {
	initOnce.Do(func() {
		log.Println("start init service...")
		// 业务初始化日志
		log.Println("init logger...")
		if err := logger.Init(); err != nil {
			log.Printf("logger init failed: %v", err)
			panic(err)
		}
		log.Println("logger init success")

		if isCollectorPersonalMode() {
			// sqlite本地存储
			resource.InitSQLite()
			log.Println("SQLite init success")
			resource.InitDuckDB()
			log.Println("DuckDB init success")

		} else {
			// PostgreSQL 存储
			log.Println("init PostgreSQL DB...")
			dbDriver := config.GetString("app.Database.Driver")
			log.Printf("database driver: %s", dbDriver)
			switch dbDriver {
			case "postgres", "postgresql", "pgsql":
				resource.InitPostgreSQL()
				log.Println("PostgreSQL init success")
			default:
				log.Println("unrecognized database driver, fallback to PostgreSQL...")
				resource.InitPostgreSQL()
				log.Println("PostgreSQL init success")
			}

			log.Println("init Redis...")
			resource.InitRedis()
			log.Println("Redis init success")
			resource.InitClickhouse()
			log.Println("Clickhouse init success")

		}
		log.Println("all services init success")
		initDone = true
	})
}

// isCollectorPersonalMode 与 app.Collector.DeploymentMode / StorageMode 推导一致（见 config.NewCollectorProxyConfig）。
func isCollectorPersonalMode() bool {
	return config.IsCollectorPersonalMode()
}

// 配置变化回调函数
func OnConfigChange(configName string) {
	log.Printf("配置已更新: %s", configName)

	// 根据不同的配置类型执行相应的重载逻辑
	switch configName {
	case "app":
		log.Println("应用配置已更新")
		log.Println("collector 配置已重载，重建服务资源")
		initDone = false
		initOnce = sync.Once{}
		MustInit()
	case "pgsql":
		if isCollectorPersonalMode() {
			log.Println("personal 模式：跳过 PostgreSQL 重连")
			return
		}
		log.Println("PostgreSQL数据库配置已更新，重新初始化数据库连接")
		resource.InitPostgreSQL()
	case "redis":
		if isCollectorPersonalMode() {
			log.Println("personal 模式：跳过 Redis 重连")
			return
		}
		log.Println("Redis配置已更新，重新初始化Redis连接")
		resource.InitRedis()
	case "logger":
		// 日志配置更新，重新初始化日志
		log.Println("日志配置已更新，重新初始化日志")
		logger.Init()
	case "all":
		// 所有配置更新，重新初始化所有服务
		log.Println("所有配置已更新，重新初始化所有服务")
		// 重置初始化状态，允许重新初始化
		initDone = false
		initOnce = sync.Once{}
		MustInit()
	default:
		log.Printf("未知配置类型: %s", configName)
	}
}
