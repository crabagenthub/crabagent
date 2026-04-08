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




msg_id
含义：业务消息级关联 id（同一条用户/渠道消息、多次上报或主命令 + 异步跟进时共用）。
作用：Collector 在 thread-trace-events-query 里从 trace 的 metadata 或 input.user_turn.message_received（及嵌套 metadata）里抽取，写到时间线事件上；Web 侧用 msg_id 合并左侧会话行（同一 msg_id 多条 message_received 合成一行等）。
关联：和 run_id 分工不同——msg_id 更贴 入站消息/产品侧合并；run_id 更贴 agent 运行链。



turn_id
含义：在 trace 的 metadata 里标记 「这一节点在回合树里的 id」。
作用：本仓库实现里 turn_id 等于当前这条 trace 的 trace_id（computeTurnMetadata 里 turnId: traceId），用于 thread 内 回合树与查询。
关联：与 parent_turn_id 成对——子回合的 parent_turn_id 指向父 trace 的 id（常是父的 turn_id / trace_id）。



parent_turn_id
含义：父回合在图/树中的 trace 标识（存于 metadata，历史上曾考虑 opik_traces.parent_trace_id 列，现已弃用该列）。
作用：
子代理（subagent）：指向父会话上 external 等父 trace；
异步跟进（async_followup）：指向同会话上前一次 external trace。
关联：与 turn_id 形成父子边；Collector 的 thread/执行图查询会读 metadata.parent_turn_id 建边。


span_id
含义：单条 span（一次 LLM 调用、一次工具调用等）在 Opik 里的主键，UUID。
作用：在同一 trace_id 下构成 执行树；工具 span 的 parent_span_id 通常指向本轮 LLM span。
关联：只属于 trace 内部；不参与 OpenClaw 的 sessionId / run_id 语义。



parent_id（以及库里的 parent_span_id）
在数据库 / ingest：Opik 表 opik_spans.parent_span_id 指向 父 span 的 span_id（根 LLM span 常为 null）。
在 Web「语义 span」API / SemanticSpanRow：字段名叫 parent_id，语义上对应 parent_span_id，用于 buildSpanForest 拼 span 树。
注意：不要和 parent_turn_id 混淆：
parent_id / parent_span_id：trace 内部 span 父子；
parent_turn_id：trace 之间（回合图）的父子。


