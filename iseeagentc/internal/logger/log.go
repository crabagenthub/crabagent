package logger

import (
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"gopkg.in/natefinch/lumberjack.v2"

	"iseeagentc/internal/config"
)

/*
   Author : lucbine
   DateTime : 2024/4/1
   Description :
*/

var Logger *zap.Logger

func Init() error {
	var logConfig LogConfig
	if err := config.Unmarshal("logger", &logConfig); err != nil {
		return err
	}

	zapCores := make([]zapcore.Core, 0)
	for _, writerSyncerConfig := range logConfig.WriterSyncerConfigs {
		newWriter := zapcore.AddSync(&lumberjack.Logger{
			Filename:   writerSyncerConfig.OutputPath,
			MaxSize:    writerSyncerConfig.MaxSize,
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
	core := zapcore.NewTee(zapCores...)
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
	Logger = zap.New(core, opts...)
	return nil
}

func Error(ctx *gin.Context, msg string, fields ...zap.Field) {
	f := wrapper(ctx, fields...)
	Logger.Error(msg, f...)
}

func Debug(ctx *gin.Context, msg string, fields ...zap.Field) {
	f := wrapper(ctx, fields...)
	Logger.Debug(msg, f...)
}

func Warn(ctx *gin.Context, msg string, fields ...zap.Field) {
	f := wrapper(ctx, fields...)
	Logger.Warn(msg, f...)
}

func Info(ctx *gin.Context, msg string, fields ...zap.Field) {
	f := wrapper(ctx, fields...)
	Logger.Info(msg, f...)
}

func DPanic(ctx *gin.Context, msg string, fields ...zap.Field) {
	f := wrapper(ctx, fields...)
	Logger.DPanic(msg, f...)
}

func Panic(ctx *gin.Context, msg string, fields ...zap.Field) {
	f := wrapper(ctx, fields...)
	Logger.Panic(msg, f...)
}

func Fatal(ctx *gin.Context, msg string, fields ...zap.Field) {
	f := wrapper(ctx, fields...)
	Logger.Fatal(msg, f...)
}

func wrapper(ctx *gin.Context, fields ...zap.Field) []zap.Field {
	var f = make([]zap.Field, 0)
	if ctx != nil {
		// request id
		f = append(f, zap.String("request_id", ctx.Request.Header.Get("X-Request-Id")))
		// request url
		f = append(f, zap.String("ip", ctx.ClientIP()))
		// user id
		f = append(f, zap.String("user_id", ctx.GetHeader("X-User-Id")))
	}
	f = append(f, fields...)
	return f
}
