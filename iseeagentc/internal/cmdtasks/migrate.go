package cmdtasks

import (
	"context"
	"time"

	"iseeagentc/internal/config"
	"iseeagentc/internal/resource"
)

// RunAgentMigrate 仅配置解析 + Agent 表迁移（与 cmd/agent-migrate 行为一致，不拉 Redis/CH）。
func RunAgentMigrate(env string, timeout time.Duration) error {
	config.Parse(env)
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return resource.RunAgentSchemaMigrations(ctx)
}
