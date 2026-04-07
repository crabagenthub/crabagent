



sessionId
含义：OpenClaw / 宿主里的 会话实例 ID（一次连接或会话文件对应的 id）。
作用：在插件里与 sessionKey、channelId、conversationId 等一起，用于 把不同 hook 上的上下文对齐到同一条 thread/trace（见 TraceAgentCtx、hookCtx 合并）。
关联：和 thread_id（常为 sessionKey） 是不同概念——thread_id 更偏「业务会话键」，sessionId 偏宿主内部会话 id；二者可能同时出现在 openclaw 上下文里。




run_id（runId）
含义：OpenClaw 在一次 agent 运行链路里下发的关联 ID（llm_input / llm_output / 工具 / subagent 等 hook 上常见）。
作用：
把 同一次运行 里的多条事件串起来；
若字符串里带有 agent:…:subagent:<uuid>，插件会用来推断 subagent_thread_id。
关联：与 trace_id 不必 1:1——一次 run_id 可能对应 UI 上「一轮用户消息后的那次 LLM」，而 trace_id 是入库时新生成的根 trace；文档里也提到同一 run_id 下多 span 共享 OTEL trace_id 的设计取向。