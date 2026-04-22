package resource

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	_ "github.com/mattn/go-sqlite3"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"gorm.io/gorm/schema"

	"iseeagentc/internal/config"
	"iseeagentc/internal/migrate"
)

var DB *gorm.DB
var DuckDBPath string
var ClickhouseURL string

type DBDebugLog struct {
}

func (D DBDebugLog) Printf(s string, i ...interface{}) {

}

func postgresAgentDSN() string {
	// connect_timeout：秒；避免本机未起 PostgreSQL 时长时间卡在 TCP 重试，导致 HTTP 迟迟不监听。
	return fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%d sslmode=disable TimeZone=Asia/Shanghai connect_timeout=5",
		config.GetString("pgsql.PostgreSQL.Host"),
		config.GetString("pgsql.PostgreSQL.Username"),
		config.GetString("pgsql.PostgreSQL.Password"),
		config.GetString("pgsql.PostgreSQL.DBName"),
		config.GetInt("pgsql.PostgreSQL.Port"),
	)
}

// InitPostgreSQL
func InitPostgreSQL() *gorm.DB {
	var db *gorm.DB

	var dialector gorm.Dialector

	conn := postgresAgentDSN()

	dialector = postgres.Open(conn)

	dbLogger := logger.New(
		&DBDebugLog{},
		logger.Config{
			LogLevel: logger.Info,
			Colorful: false,
		},
	)

	db, err := gorm.Open(dialector, &gorm.Config{
		NamingStrategy: schema.NamingStrategy{
			SingularTable: true, // 表名不使用复数
			TablePrefix:   "",   // 表名前缀
		},
		Logger: dbLogger,
	})

	if err != nil {
		panic(err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		panic(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if err := sqlDB.PingContext(ctx); err != nil {
		panic(fmt.Errorf("postgresql ping: %w", err))
	}

	if err := migrate.RunAgentTableMigrations(sqlDB); err != nil {
		panic(fmt.Errorf("agent table migration: %w", err))
	}

	DB = db
	return db
}

func resolveSQLitePath() string {
	sqlitePath := strings.TrimSpace(config.GetString("app.Collector.SQLitePath"))
	if sqlitePath == "" {
		sqlitePath = strings.TrimSpace(config.NewCollectorProxyConfig().DefaultSQLitePath)
	}
	if sqlitePath == "" {
		sqlitePath = "data/crabagent.db"
	}
	if abs, err := filepath.Abs(sqlitePath); err == nil {
		sqlitePath = abs
	}
	return sqlitePath
}

// RunAgentSchemaMigrations 仅连接配置中的 Agent 库并执行 migrate.RunAgentTableMigrations（增量 DDL）。
// 用于 CLI/CI：不启动 HTTP、不连 Redis/ClickHouse；今后表结构变更应追加到 RunAgentTableMigrations 后运行本函数或启动服务。
func RunAgentSchemaMigrations(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if config.IsCollectorPersonalMode() {
		sqlitePath := resolveSQLitePath()
		if err := os.MkdirAll(filepath.Dir(sqlitePath), 0o755); err != nil {
			return fmt.Errorf("sqlite mkdir: %w", err)
		}
		db, err := sql.Open("sqlite3", sqlitePath)
		if err != nil {
			return fmt.Errorf("sqlite open: %w", err)
		}
		defer db.Close()
		db.SetMaxOpenConns(1)
		db.SetMaxIdleConns(1)
		if _, err := db.ExecContext(ctx, `PRAGMA foreign_keys = ON`); err != nil {
			return fmt.Errorf("sqlite pragma: %w", err)
		}
		if err := db.PingContext(ctx); err != nil {
			return fmt.Errorf("sqlite ping: %w", err)
		}
		if err := migrate.RunAgentTableMigrations(db); err != nil {
			return err
		}
		return nil
	}

	db, err := sql.Open("pgx", postgresAgentDSN())
	if err != nil {
		return fmt.Errorf("postgres open: %w", err)
	}
	defer db.Close()
	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("postgresql ping: %w", err)
	}
	return migrate.RunAgentTableMigrations(db)
}

// InitSQLite 初始化 SQLite 连接并返回 gorm.DB。
func InitSQLite() *gorm.DB {
	sqlitePath := resolveSQLitePath()
	if err := os.MkdirAll(filepath.Dir(sqlitePath), 0o755); err != nil {
		panic(fmt.Errorf("sqlite mkdir failed: %w", err))
	}

	dbLogger := logger.New(
		&DBDebugLog{},
		logger.Config{
			LogLevel: logger.Info,
			Colorful: false,
		},
	)

	db, err := gorm.Open(sqlite.Open(sqlitePath), &gorm.Config{
		NamingStrategy: schema.NamingStrategy{
			SingularTable: true,
			TablePrefix:   "",
		},
		Logger: dbLogger,
	})
	if err != nil {
		panic(err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		panic(err)
	}
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := sqlDB.PingContext(ctx); err != nil {
		panic(fmt.Errorf("sqlite ping: %w", err))
	}

	if err := migrate.RunAgentTableMigrations(sqlDB); err != nil {
		panic(fmt.Errorf("agent table migration: %w", err))
	}

	DB = db
	return db
}

// InitDuckDB 初始化 DuckDB
func InitDuckDB() {
	duckDBPath := strings.TrimSpace(config.GetString("app.Collector.DuckDBPath"))
	if duckDBPath == "" {
		duckDBPath = strings.TrimSpace(config.NewCollectorProxyConfig().DuckDBPath)
	}
	if duckDBPath == "" {
		duckDBPath = "data/crabagent.analytics.duckdb"
	}
	if abs, err := filepath.Abs(duckDBPath); err == nil {
		duckDBPath = abs
	}
	if err := os.MkdirAll(filepath.Dir(duckDBPath), 0o755); err != nil {
		panic(fmt.Errorf("duckdb mkdir failed: %w", err))
	}
	f, err := os.OpenFile(duckDBPath, os.O_RDWR|os.O_CREATE, 0o644)
	if err != nil {
		panic(fmt.Errorf("duckdb file open failed: %w", err))
	}
	_ = f.Close()
	DuckDBPath = duckDBPath
}

// InitClickhouse 初始化 Clickhouse
func InitClickhouse() {
	clickhouseURL := strings.TrimSpace(config.GetString("app.Collector.ClickhouseURL"))
	if clickhouseURL == "" {
		clickhouseURL = strings.TrimSpace(config.NewCollectorProxyConfig().ClickhouseURL)
	}
	if clickhouseURL == "" {
		clickhouseURL = "http://localhost:8123"
	}
	u, err := url.Parse(clickhouseURL)
	if err != nil || strings.TrimSpace(u.Scheme) == "" || strings.TrimSpace(u.Host) == "" {
		panic(fmt.Errorf("invalid clickhouse url: %s", clickhouseURL))
	}
	pingURL := clickhouseURL
	if strings.TrimSpace(u.Path) == "" || u.Path == "/" {
		u.Path = "/ping"
		pingURL = u.String()
	}
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(pingURL)
	if err != nil {
		panic(fmt.Errorf("clickhouse ping failed: %w", err))
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		panic(fmt.Errorf("clickhouse ping status=%d", resp.StatusCode))
	}
	ClickhouseURL = clickhouseURL
}
