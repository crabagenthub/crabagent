package config

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/spf13/viper"
)

/*
   Author : lucbine
   DateTime : 2024/4/1
   Description :
*/

type config struct {
	// 数据库配置
	Viper map[string]*viper.Viper
	Env   string
	sync.RWMutex
	// 配置变化回调函数
	onConfigChange func(string)
	// 文件监控器
	watcher *fsnotify.Watcher
	// 配置文件路径
	configPath string
}

var (
	c         *config
	parseOnce sync.Once
	parseDone bool
	watchOnce sync.Once
	watchDone bool
)

func Parse(env string) {
	parseOnce.Do(func() {
		c = &config{
			Env: env,
		}
		//配置文件目录
		configPath := fmt.Sprintf("conf/%s", env)
		c.configPath = configPath

		fmt.Println("configPath:", configPath)

		dirInfos, err := os.ReadDir(configPath)
		if err != nil {
			panic(err)
		}

		c.Viper = make(map[string]*viper.Viper, len(dirInfos))

		for _, value := range dirInfos {
			if value.IsDir() {
				continue
			}
			v := viper.New()
			v.SetConfigFile(filepath.Join(configPath, value.Name()))
			v.SetConfigType("toml")
			if err := v.ReadInConfig(); err != nil {
				panic(err)
			}
			log.Println("using config file", v.ConfigFileUsed())
			filename := strings.SplitN(value.Name(), ".", 2)[0]
			c.Viper[filename] = v
		}
		parseDone = true
		log.Println("配置解析完成")
	})
}

// 当前运行环境
func GetEnv() string {
	c.RLock()
	defer c.RUnlock()
	return c.Env
}

func splitKey(key string) []string {
	return strings.SplitN(key, ".", 2)
}

func GetInt(key string) int {
	keys := splitKey(key)
	c.RLock()
	defer c.RUnlock()
	return c.Viper[keys[0]].GetInt(keys[1])
}

func GetString(key string) (res string) {
	keys := splitKey(key)
	c.RLock()
	defer c.RUnlock()
	return c.Viper[keys[0]].GetString(keys[1])
}

func GetDuration(key string) time.Duration {
	keys := splitKey(key)
	c.RLock()
	defer c.RUnlock()
	return c.Viper[keys[0]].GetDuration(keys[1])
}

func UnmarshalKey(key string, rawVal interface{}) error {
	keys := splitKey(key)
	c.RLock()
	defer c.RUnlock()
	return c.Viper[keys[0]].UnmarshalKey(keys[1], rawVal)
}

func Unmarshal(key string, rawVal interface{}) error {
	c.RLock()
	defer c.RUnlock()
	return c.Viper[key].Unmarshal(rawVal)
}

// 应用项目名称

func AppName() string {
	return c.Viper["app"].GetString("AppNames")
}

func SigningKey() []byte {
	signingKey := c.Viper["app"].GetString("SigningKey")
	return []byte(signingKey)
}

func JwtATokenExpire() int {
	return c.Viper["app"].GetInt("JwtATokenExpire")
}

func JwtRTokenExpire() int {
	return c.Viper["app"].GetInt("JwtRTokenExpire")
}

// 设置配置变化回调函数
func SetConfigChangeCallback(callback func(string)) {
	c.Lock()
	defer c.Unlock()
	c.onConfigChange = callback
}

// 启动配置监控
func StartWatch() error {
	var err error
	watchOnce.Do(func() {
		c.watcher, err = fsnotify.NewWatcher()
		if err != nil {
			err = fmt.Errorf("创建文件监控器失败: %v", err)
			return
		}

		// 监控配置文件目录
		err = c.watcher.Add(c.configPath)
		if err != nil {
			err = fmt.Errorf("添加监控目录失败: %v", err)
			return
		}

		// 启动监控协程
		go c.watchConfig()

		log.Println("配置监控已启动，监控目录:", c.configPath)
		watchDone = true
	})
	return err
}

// 停止配置监控
func StopWatch() error {
	if c.watcher != nil {
		return c.watcher.Close()
	}
	return nil
}

// 监控配置文件变化
func (c *config) watchConfig() {
	for {
		select {
		case event, ok := <-c.watcher.Events:
			if !ok {
				return
			}
			// 只处理写入和重命名事件
			if event.Op&fsnotify.Write == fsnotify.Write || event.Op&fsnotify.Rename == fsnotify.Rename {
				c.handleConfigChange(event.Name)
			}
		case err, ok := <-c.watcher.Errors:
			if !ok {
				return
			}
			log.Printf("配置监控错误: %v", err)
		}
	}
}

// 处理配置变化
func (c *config) handleConfigChange(filename string) {
	// 获取文件名（不含扩展名）
	baseName := filepath.Base(filename)
	configName := strings.SplitN(baseName, ".", 2)[0]

	// 检查是否是已知的配置文件
	c.RLock()
	viperInstance, exists := c.Viper[configName]
	c.RUnlock()

	if !exists {
		return
	}

	// 重新读取配置文件
	err := viperInstance.ReadInConfig()
	if err != nil {
		log.Printf("重新读取配置文件失败 %s: %v", filename, err)
		return
	}

	log.Printf("配置文件已更新: %s", filename)

	// 调用回调函数
	if c.onConfigChange != nil {
		c.onConfigChange(configName)
	}
}

// 手动重载指定配置
func ReloadConfig(configName string) error {
	c.RLock()
	viperInstance, exists := c.Viper[configName]
	c.RUnlock()

	if !exists {
		return fmt.Errorf("配置 %s 不存在", configName)
	}

	err := viperInstance.ReadInConfig()
	if err != nil {
		return fmt.Errorf("重载配置 %s 失败: %v", configName, err)
	}

	log.Printf("配置 %s 已手动重载", configName)

	// 调用回调函数
	if c.onConfigChange != nil {
		c.onConfigChange(configName)
	}

	return nil
}

// 重载所有配置
func ReloadAllConfigs() error {
	c.RLock()
	defer c.RUnlock()

	var errors []string
	for configName, viperInstance := range c.Viper {
		err := viperInstance.ReadInConfig()
		if err != nil {
			errors = append(errors, fmt.Sprintf("%s: %v", configName, err))
		} else {
			log.Printf("配置 %s 已重载", configName)
		}
	}

	if len(errors) > 0 {
		return fmt.Errorf("部分配置重载失败: %v", errors)
	}

	// 调用回调函数
	if c.onConfigChange != nil {
		c.onConfigChange("all")
	}

	return nil
}

// —— Collector（与历史 service/collector_config 合并，单一配置入口）——

// CollectorProxyConfig 表示 collector HTTP 代理与运行时所需配置（来自 app.toml [Collector] 等）。
type CollectorProxyConfig struct {
	DefaultSQLitePath string
	DeploymentMode    string
	StorageMode       string
	DuckDBPath        string
	PGURL             string
	ClickhouseURL     string
	APIKey            string
	DisableAPIKeyAuth string
	CORSOrigin        string
	DefaultWindowMs   int
}

func normalizeCollectorMode(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "enterprise", "commercial", "business":
		return "enterprise"
	case "personal", "private":
		return "personal"
	default:
		return ""
	}
}

func normalizeCollectorStorage(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "sqlite":
		return "sqlite"
	case "pgsql", "postgres", "postgresql":
		return "pgsql"
	default:
		return ""
	}
}

// resolveCollectorModes 收敛 collector 模式：DeploymentMode > StorageMode > Database.Driver，默认 personal/sqlite。
func resolveCollectorModes(deploymentMode, storageMode, dbDriver string) (string, string) {
	mode := normalizeCollectorMode(deploymentMode)
	storage := normalizeCollectorStorage(storageMode)
	driver := normalizeCollectorStorage(dbDriver)

	if mode == "" {
		switch {
		case storage == "pgsql":
			mode = "enterprise"
		case storage == "sqlite":
			mode = "personal"
		case driver == "pgsql":
			mode = "enterprise"
		default:
			mode = "personal"
		}
	}
	if mode == "enterprise" {
		return "enterprise", "pgsql"
	}
	return "personal", "sqlite"
}

func safeCollectorGetString(key string) string {
	defer func() {
		_ = recover()
	}()
	return strings.TrimSpace(GetString(key))
}

func defaultCollectorSQLitePathFromWorkspace() string {
	wd, err := os.Getwd()
	if err != nil {
		return "data/crabagent.db"
	}
	// Repo root: iseeagentc/data/crabagent.db
	if _, err := os.Stat(filepath.Join(wd, "iseeagentc", "go.mod")); err == nil {
		return filepath.Join(wd, "iseeagentc", "data", "crabagent.db")
	}
	// iseeagentc/ as cwd
	if _, err := os.Stat(filepath.Join(wd, "go.mod")); err == nil {
		return filepath.Join(wd, "data", "crabagent.db")
	}
	return filepath.Join(wd, "data", "crabagent.db")
}

// IsCollectorPersonalMode 是否与 bootstrap 一致：personal 部署走 SQLite，否则走 PostgreSQL 等企业依赖。
// 须在 config.Parse 之后调用。
func IsCollectorPersonalMode() bool {
	cfg := NewCollectorProxyConfig()
	ApplyCollectorEnvDefaults(cfg)
	return strings.EqualFold(strings.TrimSpace(cfg.DeploymentMode), "personal")
}

// NewCollectorProxyConfig 从已加载的 viper 配置读取 collector 相关项。
func NewCollectorProxyConfig() CollectorProxyConfig {
	resolvedMode, resolvedStorage := resolveCollectorModes(
		safeCollectorGetString("app.Collector.DeploymentMode"),
		safeCollectorGetString("app.Collector.StorageMode"),
		safeCollectorGetString("app.Database.Driver"),
	)
	cfg := CollectorProxyConfig{
		DeploymentMode:    resolvedMode,
		StorageMode:       resolvedStorage,
		DuckDBPath:        safeCollectorGetString("app.Collector.DuckDBPath"),
		PGURL:             safeCollectorGetString("app.Collector.PGURL"),
		ClickhouseURL:     safeCollectorGetString("app.Collector.ClickhouseURL"),
		APIKey:            safeCollectorGetString("app.Collector.APIKey"),
		DisableAPIKeyAuth: safeCollectorGetString("app.Collector.DisableAPIKeyAuth"),
		CORSOrigin:        safeCollectorGetString("app.Collector.CORSOrigin"),
		DefaultWindowMs:   GetInt("app.Collector.DefaultTimeWindowMs"),
	}

	cfgPath := safeCollectorGetString("app.Collector.DBPath")
	if cfgPath == "" {
		cfgPath = safeCollectorGetString("app.Collector.SqlitePath")
	}
	if cfgPath != "" {
		if abs, err := filepath.Abs(cfgPath); err == nil {
			cfg.DefaultSQLitePath = abs
			return cfg
		}
		cfg.DefaultSQLitePath = cfgPath
		return cfg
	}
	cfg.DefaultSQLitePath = defaultCollectorSQLitePathFromWorkspace()
	return cfg
}

// ApplyCollectorEnvDefaults 将 collector 配置写入 CRABAGENT_* 环境变量（供 internal/collector 读取）。
func ApplyCollectorEnvDefaults(cfg CollectorProxyConfig) {
	setIfNotEmpty := func(key, val string) {
		val = strings.TrimSpace(val)
		if val != "" {
			_ = os.Setenv(key, val)
		}
	}
	setIfPositiveInt := func(key string, n int) {
		if n > 0 {
			_ = os.Setenv(key, strconv.Itoa(n))
		}
	}

	setIfNotEmpty("CRABAGENT_DEPLOYMENT_MODE", cfg.DeploymentMode)
	setIfNotEmpty("CRABAGENT_STORAGE_MODE", cfg.StorageMode)
	setIfNotEmpty("CRABAGENT_DB_PATH", cfg.DefaultSQLitePath)
	setIfNotEmpty("CRABAGENT_DUCKDB_PATH", cfg.DuckDBPath)
	setIfNotEmpty("CRABAGENT_PG_URL", cfg.PGURL)
	setIfNotEmpty("CRABAGENT_CLICKHOUSE_URL", cfg.ClickhouseURL)
	setIfNotEmpty("CRABAGENT_API_KEY", cfg.APIKey)
	setIfNotEmpty("CRABAGENT_CORS_ORIGIN", cfg.CORSOrigin)
	setIfPositiveInt("CRABAGENT_DEFAULT_TIME_WINDOW_MS", cfg.DefaultWindowMs)
	setIfNotEmpty("CRABAGENT_DISABLE_API_KEY_AUTH", cfg.DisableAPIKeyAuth)
}

// CollectorConfigSummary 返回脱敏后的 collector 配置摘要（日志用）。
func CollectorConfigSummary(cfg CollectorProxyConfig) string {
	auth := "off"
	if strings.EqualFold(strings.TrimSpace(cfg.DisableAPIKeyAuth), "true") || strings.TrimSpace(cfg.DisableAPIKeyAuth) == "1" {
		auth = "bypassed"
	} else if strings.TrimSpace(cfg.APIKey) != "" {
		auth = "on"
	}
	return fmt.Sprintf(
		"mode=%s storage=%s sqlite=%s duckdb=%s pg=%t ch=%t auth=%s window_ms=%d",
		strings.TrimSpace(cfg.DeploymentMode),
		strings.TrimSpace(cfg.StorageMode),
		strings.TrimSpace(cfg.DefaultSQLitePath),
		strings.TrimSpace(cfg.DuckDBPath),
		strings.TrimSpace(cfg.PGURL) != "",
		strings.TrimSpace(cfg.ClickhouseURL) != "",
		auth,
		cfg.DefaultWindowMs,
	)
}
