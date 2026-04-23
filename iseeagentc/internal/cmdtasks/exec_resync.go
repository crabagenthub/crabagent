package cmdtasks

import (
	"fmt"
	"log"

	"iseeagentc/bootstrap"
	"iseeagentc/internal/config"
	"iseeagentc/internal/resource"
	"iseeagentc/model"
)

// ExecResyncOptions 与 cmd/agent-exec-resync 旗标一致。
type ExecResyncOptions struct {
	Env     string
	SinceMs int64
	UntilMs int64
	Batch   int
	Once    bool
	MaxRows int
}

// RunExecResync 重算并 UPSERT agent_exec_commands；成功返回累计 upsert 行数。
func RunExecResync(o ExecResyncOptions) (int, error) {
	if o.Env == "" {
		o.Env = "dev"
	}
	if o.Batch <= 0 {
		o.Batch = 400
	}
	if err := bootstrap.ServiceInit(o.Env); err != nil {
		return 0, err
	}
	if config.IsCollectorPersonalMode() {
		cc := config.NewCollectorProxyConfig()
		log.Printf("collector: %s", config.CollectorConfigSummary(cc))
	} else {
		log.Printf("collector: enterprise (PostgreSQL)")
	}
	gdb := resource.DB
	if gdb == nil {
		return 0, fmt.Errorf("database not initialized (check collector mode / config)")
	}
	sqlDB, err := gdb.DB()
	if err != nil {
		return 0, err
	}
	if all, shell, execN, err := model.ExecCommandsResyncDiagnostics(sqlDB); err != nil {
		log.Printf("diagnostics: %v", err)
	} else {
		log.Printf("before resync: agent_spans=%d shell_like_tool_spans=%d agent_exec_commands=%d (shell_like 为 0 则不会写入任何行)",
			all, shell, execN)
	}

	opts := model.ResyncExecCommandsOptions{
		Batch:   o.Batch,
		Once:    o.Once,
		MaxRows: o.MaxRows,
	}
	if o.SinceMs > 0 {
		v := o.SinceMs
		opts.SinceMs = &v
	}
	if o.UntilMs > 0 {
		v := o.UntilMs
		opts.UntilMs = &v
	}

	total, err := model.ResyncAgentExecCommands(sqlDB, opts)
	if err != nil {
		return 0, err
	}
	if all, shell, execN, err := model.ExecCommandsResyncDiagnostics(sqlDB); err != nil {
		log.Printf("after diagnostics: %v", err)
	} else {
		log.Printf("after resync: agent_spans=%d shell_like_tool_spans=%d agent_exec_commands=%d", all, shell, execN)
	}
	log.Printf("agent_exec_commands resync done: upserted=%d since_ms=%d until_ms=%d batch=%d once=%v max_rows=%d",
		total, o.SinceMs, o.UntilMs, o.Batch, o.Once, o.MaxRows)
	return total, nil
}
