package logger

import (
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"gopkg.in/natefinch/lumberjack.v2"

	"iseeagentc/internal/config"
)

var AccessLogger *zap.Logger

type LogConfig struct {
	WriterSyncerConfigs   []WriterSyncerConfig `mapstructure:"loggers"`
	AddStacktrace         bool                 `mapstructure:"add_stacktrace"`
	AddStacktraceMinLevel zapcore.Level        `mapstructure:"add_stacktrace_min_level"`
	AddCaller             bool                 `mapstructure:"add_caller"`
	Development           bool                 `mapstructure:"development"`
	AddCallerSkip         bool                 `mapstructure:"add_caller_skip"`
	AddCallerSkipVal      int                  `mapstructure:"add_caller_skip_val"`
}

type WriterSyncerConfig struct {
	OutputPath string        `mapstructure:"output_path"`
	MaxSize    int           `mapstructure:"max_size"`
	MaxBackups int           `mapstructure:"max_backups"`
	MaxAge     int           `mapstructure:"max_age"`
	LocalTime  bool          `mapstructure:"localtime"`
	Compress   bool          `mapstructure:"compress"`
	TimeFormat string        `mapstructure:"time_format"`
	MinLevel   zapcore.Level `mapstructure:"min_level"`
	MaxLevel   zapcore.Level `mapstructure:"max_level"`
}

func InitAccessLog() {
	var logConfig LogConfig
	if err := config.Unmarshal("access_log", &logConfig); err != nil {
		panic(err)
	}
	zapCores := make([]zapcore.Core, 0)
	for _, writerSyncerConfig := range logConfig.WriterSyncerConfigs {
		newWriter := zapcore.AddSync(&lumberjack.Logger{
			Filename:   writerSyncerConfig.OutputPath,
			MaxSize:    writerSyncerConfig.MaxSize, // megabytes
			MaxBackups: writerSyncerConfig.MaxBackups,
			MaxAge:     writerSyncerConfig.MaxAge,
			LocalTime:  writerSyncerConfig.LocalTime,
			Compress:   writerSyncerConfig.Compress,
		})
		cfg := zap.NewProductionEncoderConfig()
		cfg.EncodeTime = func(t time.Time, enc zapcore.PrimitiveArrayEncoder) {
			enc.AppendString(t.Format("2006-01-02 15:04:05.000000"))
		}
		newCore := func(minLevel, maxLevel zapcore.Level) zapcore.Core {
			return zapcore.NewCore(
				zapcore.NewJSONEncoder(cfg),
				newWriter,
				zap.LevelEnablerFunc(func(lvl zapcore.Level) bool {
					return lvl >= minLevel && lvl <= maxLevel
				}),
			)
		}(writerSyncerConfig.MinLevel, writerSyncerConfig.MaxLevel)
		zapCores = append(zapCores, newCore)
	}
	core := zapcore.NewTee(
		zapCores...,
	)
	opts := make([]zap.Option, 0)
	if logConfig.AddStacktrace {
		opts = append(opts, zap.AddStacktrace(logConfig.AddStacktraceMinLevel))
	}
	if logConfig.AddCaller {
		opts = append(opts, zap.AddCaller())
	}
	if logConfig.Development {
		opts = append(opts, zap.Development())
	}
	if logConfig.AddCallerSkip {
		opts = append(opts, zap.AddCallerSkip(logConfig.AddCallerSkipVal))
	}
	AccessLogger = zap.New(core, opts...)
}
