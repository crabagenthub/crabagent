# Agent 兼容性评审报告

**评审目标**：评估 crabagent 系统兼容 OpenClaw 和 Hermes-Agent 两大通用 Agent 框架的可行性，设计可扩展的统一 trace、审计、安全系统。

**评审日期**：2025年1月

---

## 1. 执行摘要

### 1.1 核心结论

| 维度 | 评估结果 | 关键挑战 |
|------|----------|----------|
| **架构兼容性** | ⭐⭐⭐⭐☆ 良好 | 语言差异（TS vs Python），运行时模型不同 |
| **数据模型兼容** | ⭐⭐⭐⭐☆ 良好 | 事件结构差异，需设计通用抽象层 |
| **安全审计** | ⭐⭐⭐⭐⭐ 优秀 | 两者均有完善的敏感信息脱敏机制 |
| **扩展性** | ⭐⭐⭐⭐☆ 良好 | Plugin SDK vs 直接集成两种模式并存 |
| **实施复杂度** | 中等偏高 | 需开发 Python SDK + 适配器 + Collector 增强 |

### 1.2 总体建议

**✅ 兼容方案可行**。建议采用 **分层架构 + 双模式接入** 策略：

1. **OpenClaw**：复用现有 `openclaw-trace-plugin`，保持 Hook/Plugin 模式
2. **Hermes-Agent**：开发 `hermes-trace-sdk` Python 包，通过 HTTP Ingest 直连 Collector
3. **Collector 增强**：增加异构数据归一化层，支持多 Agent 格式转换
4. **通用抽象**：定义跨语言的 `UniversalTraceEvent` 事件模型作为通用语言

---

## 2. 三大系统架构分析

### 2.1 Crabagent（现有系统）

```
┌─────────────────────────────────────────────────────────┐
│                    Crabagent 架构                        │
├─────────────────────────────────────────────────────────┤
│  Layer 1: openclaw-trace-plugin (TypeScript)            │
│    - 订阅 OpenClaw Plugin SDK Hooks                     │
│    - 内存队列 + Flush Worker                            │
│    - SQLite Outbox 重试机制                             │
├─────────────────────────────────────────────────────────┤
│  Layer 2: Collector (Node.js/Bun + SQLite)              │
│    - POST /v1/ingest 接收 gzip 批量事件                  │
│    - 归一化存储到 SQLite                                 │
│    - SSE 流式推送                                        │
├─────────────────────────────────────────────────────────┤
│  Layer 3: Web (Next.js + shadcn/ui)                     │
│    - Trace 查询与可视化                                  │
│    - 安全审计 Dashboard                                  │
│    - Token 优化策略管理                                  │
└─────────────────────────────────────────────────────────┘
```

**核心事件模型**（`/packages/openclaw-trace-plugin/config.ts`）：
- `llm_input` / `llm_output`：Turn 级模型交互
- `agent_end`：会话结束快照
- `before_tool_call` / `after_tool_call`：工具执行跨度
- `before_compaction` / `after_compaction`：上下文压缩
- `session_start`：会话采样决策点

**安全特性**：
- 敏感信息脱敏（`redactBeforeCollectorPost` 配置）
- API Key 仅存储哈希
- 支持 Vault 加密（Pro 档）
- 审计日志与策略命中追踪

### 2.2 OpenClaw（TypeScript 宿主）

```
┌─────────────────────────────────────────────────────────┐
│                    OpenClaw 架构                         │
├─────────────────────────────────────────────────────────┤
│  Core: Node.js/TypeScript 运行时                        │
│    - 多渠道 Gateway (Telegram/WhatsApp/Slack等)          │
│    - Plugin SDK 扩展系统                                 │
│    - Agent 路由与多轮对话管理                             │
├─────────────────────────────────────────────────────────┤
│  Diagnostics:                                           │
│    - diagnostic-events.ts: 内部诊断事件类型               │
│    - diagnostics-otel: OpenTelemetry 导出插件            │
│    - cache-trace.jsonl: 详细执行轨迹日志                  │
├─────────────────────────────────────────────────────────┤
│  Event Types:                                           │
│    - model.usage: 模型调用与成本                         │
│    - webhook.*: Webhook 生命周期                         │
│    - message.*: 消息队列状态                               │
│    - session.*: 会话状态监控                               │
└─────────────────────────────────────────────────────────┘
```

**关键集成点**（`/extensions/diagnostics-otel/src/service.ts`）：
- 订阅 `onDiagnosticEvent` 回调
- 转换为 OpenTelemetry Spans/Metrics/Logs
- 支持 OTLP 导出到外部系统

**会话模型**：
- `sessionKey`：路由维度标识（如 `agent:main:telegram:dm:user_123`）
- `sessionId`：持久化会话 ID
- `runId`：单次执行 ID
- `trace_root_id`：Crabagent 生成的追踪根 ID

### 2.3 Hermes-Agent（Python 宿主）

```
┌─────────────────────────────────────────────────────────┐
│                  Hermes-Agent 架构                       │
├─────────────────────────────────────────────────────────┤
│  Core: Python 运行时                                      │
│    - run_agent.py: 主 Agent 执行循环                      │
│    - gateway/: 多平台 Gateway 实现                        │
│    - 技能系统与上下文压缩                                │
├─────────────────────────────────────────────────────────┤
│  Observability:                                         │
│    - hermes_logging.py: 集中式日志 + 会话上下文           │
│    - gateway/session.py: 会话管理与持久化                  │
│    - transcript.jsonl: 完整对话记录                        │
├─────────────────────────────────────────────────────────┤
│  Key Features:                                          │
│    - ContextCompressor: 智能上下文压缩                    │
│    - _execute_tool_calls_*: 工具执行（顺序/并发）         │
│    - PII Redaction: 内置敏感信息脱敏                      │
│    - Learning Loop: 自动技能生成与改进                     │
└─────────────────────────────────────────────────────────┘
```

**关键组件**（`run_agent.py`）：
- `_compress_context()`: 上下文压缩与 SQLite 会话分割
- `_execute_tool_calls_concurrent()`: 并发工具执行
- `_execute_tool_calls_sequential()`: 顺序工具执行

**日志系统**（`hermes_logging.py`）：
- 线程级会话上下文（`set_session_context()`）
- RotatingFileHandler + RedactingFormatter
- 三日志分离：`agent.log` / `errors.log` / `gateway.log`

**会话模型**（`gateway/session.py`）：
- `SessionSource`: 消息来源（平台、chat_id、user_id）
- `append_to_transcript()`: SQLite + JSONL 双写
- `_hash_id()`: PII 脱敏哈希

---

## 3. 兼容性详细对比

### 3.1 事件模型对比

| 维度 | OpenClaw | Hermes-Agent | 兼容难度 |
|------|----------|--------------|----------|
| **架构** | 基于 Hook 的回调事件 | 基于 Python logging + 函数拦截 | 中 |
| **Turn 级别** | `llm_input` → `llm_output` | `run_conversation()` 循环内日志 | 低 |
| **工具执行** | `before/after_tool_call` Hooks | `_invoke_tool()` 函数内日志 | 低 |
| **会话管理** | `session_start` / `agent_end` | Gateway session 生命周期 | 中 |
| **上下文压缩** | `before/after_compaction` | `_compress_context()` 显式调用 | 低 |
| **模型用量** | `model.usage` diagnostic | API 调用处日志记录 | 低 |

### 3.2 数据持久化对比

| 维度 | OpenClaw | Hermes-Agent | 兼容策略 |
|------|----------|--------------|----------|
| **本地存储** | SQLite Outbox（网关本地） | SQLite + JSONL（会话存储） | 复用 Collector 远端存储 |
| **传输方式** | 批量 gzip HTTP POST | 文件日志 | 需开发 HTTP SDK |
| **脱敏时机** | 插件层（可配置） | RotatingFileHandler | Collector 统一脱敏 |
| **实时性** | Flush Worker 定时推送 | 文件写入 | Python SDK 需实现批量缓冲 |

### 3.3 身份与会话模型对比

| 维度 | OpenClaw | Hermes-Agent | 统一方案 |
|------|----------|--------------|----------|
| **用户 ID** | `sessionKey` 包含平台+用户 | `SessionSource.user_id` | 映射到 `user_id` 字段 |
| **会话 ID** | `sessionId` / `runId` | `session_id` | 统一 `session_id` 概念 |
| **平台** | 嵌入 `sessionKey` | `SessionSource.platform` | 显式 `platform` 字段 |
| **Trace 关联** | `trace_root_id` 内存维护 | 无内置 | Python SDK 需生成兼容 ID |

### 3.4 安全与审计能力对比

| 维度 | OpenClaw | Hermes-Agent | 状态 |
|------|----------|--------------|------|
| **敏感信息脱敏** | ✅ `RedactingFormatter` | ✅ `_hash_id()` | 两者都有 |
| **审计日志** | ✅ `security_audit_logs` | ✅ 日志分离 | 两者都有 |
| **策略拦截** | ✅ `abort_run` | ⚠️ 需扩展 | Python SDK 需实现 |
| **加密存储** | ✅ Vault (Pro档) | ❌ 需扩展 | 依赖 Collector |
| **TLS 传输** | ✅ HTTPS | ⚠️ 需实现 | Python SDK 默认 HTTPS |

---

## 4. 统一系统设计方案

### 4.1 推荐架构：分层双模式

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Unified Trace & Audit System                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────┐          ┌─────────────────┐                 │
│  │  OpenClaw Host   │          │  Hermes-Agent    │                 │
│  │  (TypeScript)    │          │  (Python)         │                 │
│  └────────┬────────┘          └────────┬────────┘                 │
│           │                            │                          │
│           │ Plugin SDK                   │                         │
│           ▼                            │                         │
│  ┌─────────────────┐          ┌─────────▼─────────┐                 │
│  │ openclaw-trace  │          │ hermes-trace-sdk  │                 │
│  │ -plugin         │          │ (Python Package)  │                 │
│  │                 │          │                   │                 │
│  │ • Hook订阅      │          │ • Decorator拦截   │                 │
│  │ • 内存队列      │          │ • 批量缓冲        │                 │
│  │ • SQLite Outbox │          │ • 重试机制        │                 │
│  └────────┬────────┘          └─────────┬─────────┘                 │
│           │                              │                          │
│           │ UniversalTraceEvent          │ UniversalTraceEvent      │
│           │ (JSON/gzip)                  │ (JSON/gzip)              │
│           └──────────────┬───────────────┘                          │
│                          │                                          │
│                          ▼                                          │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                    Collector (Node.js/Bun)                      │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │ │
│  │  │   Ingest    │  │ Normalizer  │  │   Store     │             │ │
│  │  │  Receiver   │→ │  (Agent     │→ │  (SQLite/   │             │ │
│  │  │             │  │  Adapter)   │  │   Postgres) │             │ │
│  │  │ • Auth      │  │             │  │             │             │ │
│  │  │ • Gzip      │  │ • Format    │  │ • Events    │             │ │
│  │  │ • Validate  │  │   Convert   │  │ • Audit     │             │ │
│  │  └─────────────┘  └─────────────┘  │   Logs      │             │ │
│  │                                     └─────────────┘             │ │
│  │  ┌─────────────┐  ┌─────────────┐                             │ │
│  │  │   Policy    │  │    SSE      │                             │ │
│  │  │   Engine    │  │   Stream    │                             │ │
│  │  │             │  │             │                             │ │
│  │  │ • Rule Eval │  │ • Real-time │                             │ │
│  │  │ • Alert     │  │   Push      │                             │ │
│  │  └─────────────┘  └─────────────┘                             │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                          │                                          │
│                          ▼                                          │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                      Web Dashboard (Next.js)                  │ │
│  │                                                               │ │
│  │  • Trace Explorer  • Audit Dashboard  • Policy Manager       │ │
│  │  • Agent Selector  • Cross-Agent View   • Security Alerts      │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 核心设计决策

#### 决策 1：Collector 归一化策略（选项 B + C 混合）

**方案**：轻量 Collector + 内置 Agent Adapter

- **Ingest 层**：保持无状态，只负责接收、解压、基础校验
- **Normalizer 层**：内置 Agent-specific 转换器
  - `OpenClawAdapter`: 透传或轻量转换
  - `HermesAdapter`: Python 事件 → UniversalTraceEvent
- **存储层**：统一 SQLite/PostgreSQL 表结构

**理由**：
- OpenClaw 已有完善的事件模型，减少转换开销
- Hermes 需适配，但转换逻辑集中便于维护
- 未来新 Agent 只需添加 Adapter

#### 决策 2：Trace 关联策略（选项 C：灵活配置）

**方案**：支持两种模式，配置化切换

```typescript
// 模式 A：严格隔离（默认）
trace_root_id = "oc:{sessionKey}"  // OpenClaw
trace_root_id = "hermes:{session_id}"  // Hermes

// 模式 B：统一聚合（跨 Agent 场景）
trace_root_id = "user:{user_id}:{date}"  // 超级 Trace
agent_span_id = "{agent_type}:{local_id}"  // 子 Agent 区分
```

**配置项**：
```yaml
trace_mode: "isolated" | "unified"
trace_key_template: "user:{user_id}:{date}"
```

#### 决策 3：安全审计粒度（选项 C：分层审计）

**三层审计模型**：

| 层级 | 内容 | 存储 | 保留期 |
|------|------|------|--------|
| **基础层** | 命令执行、资源访问、安全策略命中 | `security_audit_logs` 表 | 1-3年 |
| **链路层** | Turn 级输入输出、工具调用 | `events` 表 | 7-30天 |
| **合规层** | 完整对话、PII 访问记录 | 加密存储/Vault | 按需 |

**脱敏策略**：
- Collector 接收前脱敏（Hermes SDK 可选）
- Collector 存储前脱敏（推荐，统一策略）
- 查询时动态脱敏（基于用户权限）

### 4.3 UniversalTraceEvent 通用事件模型

```typescript
// 跨语言通用事件信封
interface UniversalTraceEvent {
  // === 元数据 ===
  schema_version: 1;
  event_id: string;           // UUID v4
  timestamp: string;          // ISO8601
  
  // === 追踪标识 ===
  trace_root_id: string;      // 全局追踪根
  parent_span_id?: string;    // 父跨度（子 Agent/工具调用）
  span_id: string;            // 当前跨度
  
  // === 来源标识 ===
  agent_type: "openclaw" | "hermes" | string;
  agent_version: string;
  integration_id: string;     // 集成实例标识
  
  // === 会话标识 ===
  session_id: string;
  user_id: string;           // 脱敏后的用户标识
  platform: string;         // telegram/discord/slack/...
  channel_id?: string;       // 群组/频道标识
  
  // === 事件类型 ===
  type: 
    | "session_start"
    | "turn_start"           // 用户输入/系统触发
    | "llm_request"          // 模型调用
    | "llm_response"         // 模型响应
    | "tool_call"            // 工具执行
    | "context_compaction"   // 上下文压缩
    | "session_end"
    | "security_policy_hit"  // 安全策略命中
    | "error";
  
  // === 载荷（按类型变化）===
  payload: {
    // 通用字段
    duration_ms?: number;
    error?: string;
    
    // llm_request/response
    model?: string;
    provider?: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_read?: number;
      cache_write?: number;
    };
    cost_usd?: number;
    
    // tool_call
    tool_name?: string;
    tool_input?: Record<string, unknown>;
    tool_output?: string;
    tool_error?: string;
    
    // security_policy_hit
    policy_id?: string;
    policy_type?: "content_filter" | "command_block" | "rate_limit";
    blocked?: boolean;
    
    // 扩展字段（Agent 特定）
    [key: string]: unknown;
  };
  
  // === 能力标记 ===
  capabilities: {
    has_full_context: boolean;
    redacted: boolean;
    compressed: boolean;
  };
}
```

---

## 5. 实施路线图

### 5.1 阶段一：基础兼容（4-6周）

**目标**：Hermes-Agent 基础 Trace 接入

**任务**：
1. **Python SDK 开发** (`hermes-trace-sdk`)
   - Decorator 拦截：`_invoke_tool()`, `run_conversation()`
   - 批量缓冲队列 + 后台 Flush 线程
   - 配置管理 + 重试机制
   
2. **Collector Adapter**
   - `HermesAdapter` 实现
   - 字段映射：Hermes 日志 → UniversalTraceEvent
   
3. **Web 界面适配**
   - Agent 类型筛选器
   - Hermes 事件渲染适配

**交付物**：
- `hermes-trace-sdk` PyPI 包
- Collector v1.1（支持多 Agent）
- Web Agent 选择器

### 5.2 阶段二：能力对齐（4-6周）

**目标**：功能对等，统一体验

**任务**：
1. **Hermes 会话追踪**
   - Gateway 集成 SDK
   - Session 生命周期事件
   - Transcript 关联
   
2. **策略引擎扩展**
   - Hermes 安全策略拦截点
   - 统一策略配置格式
   
3. **OpenClaw 能力补齐**
   - 子 Agent 跨系统追踪
   - Context Compression 详细事件

**交付物**：
- Hermes Gateway 原生集成
- 跨 Agent 策略引擎
- 统一配置 Schema

### 5.3 阶段三：高级特性（6-8周）

**目标**：企业级功能

**任务**：
1. **跨 Agent 追踪**
   - 统一 `trace_root_id` 生成策略
   - 父子 Span 关联可视化
   
2. **企业安全**
   - Vault 集成（Hermes 侧）
   - 审计日志导出（SIEM 集成）
   - 合规报告自动化
   
3. **第三方 Agent 支持**
   - 文档化 SDK 开发指南
   - LangChain/LlamaIndex 适配器示例

**交付物**：
- 企业安全套件
- 跨 Agent 追踪视图
- 第三方 Agent 接入文档

### 5.4 依赖与风险

| 风险 | 概率 | 缓解措施 |
|------|------|----------|
| Hermes 运行时侵入性 | 中 | 优先 Decorator 非侵入方案；与 Hermes 社区沟通 |
| 性能开销 | 中 | SDK 异步缓冲 + 采样率控制 |
| 数据模型演进冲突 | 低 | Schema Version 机制；Adapter 隔离 |
| 多 Agent 并发压力 | 中 | Collector 水平扩展 + PostgreSQL 迁移路径 |
| 安全合规差异 | 低 | 默认严格脱敏；企业版 Vault 可选 |

---

## 6. 关键代码映射

### 6.1 Hermes-Agent 集成点

```python
# 建议集成方式：非侵入式 Decorator

# hermes_trace_sdk/decorators.py
import functools
import time
from typing import Callable, Any
from .client import TraceClient

client = TraceClient()

def trace_tool_call(func: Callable) -> Callable:
    """工具执行追踪装饰器"""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        span_id = client.start_span(
            type="tool_call",
            tool_name=func.__name__,
            tool_input=kwargs
        )
        start = time.time()
        try:
            result = func(*args, **kwargs)
            client.end_span(span_id, {
                "tool_output": result,
                "duration_ms": int((time.time() - start) * 1000)
            })
            return result
        except Exception as e:
            client.end_span(span_id, {
                "error": str(e),
                "duration_ms": int((time.time() - start) * 1000)
            }, error=True)
            raise
    return wrapper

# 在 Hermes 中的使用（建议修改点）
# run_agent.py:7209-7617 的 _invoke_tool 方法
class ToolExecutor:
    @trace_tool_call  # ← 添加装饰器
    def _invoke_tool(self, function_name: str, function_args: dict, ...):
        # 原有实现不变
        ...
```

### 6.2 OpenClaw 现有事件对应

| OpenClaw Hook | UniversalTraceEvent Type | 说明 |
|---------------|--------------------------|------|
| `llm_input` | `turn_start` + `llm_request` | 拆分为两个事件 |
| `llm_output` | `llm_response` | 包含 usage 和 cost |
| `before_tool_call` | `tool_call` (partial) | 记录输入 |
| `after_tool_call` | `tool_call` (complete) | 更新输出/错误 |
| `agent_end` | `session_end` | 会话结束快照 |
| `session_start` | `session_start` | 采样决策 |

---

## 7. 结论与建议

### 7.1 兼容性结论

| 评估项 | 评分 | 说明 |
|--------|------|------|
| **整体可行** | 8.5/10 | 架构差异可桥接，语言差异通过 SDK 解决 |
| **技术债务** | 低 | Hermes 需少量侵入性修改，但影响可控 |
| **长期演进** | 高 | 通用事件模型支持未来 Agent 接入 |

### 7.2 架构建议

1. **保持 Collector 中立**：作为多 Agent 的数据枢纽，不负责业务逻辑
2. **SDK 语言绑定**：TypeScript/Python 分别维护，保持与宿主习惯一致
3. **渐进式迁移**：Hermes 从 Sidecar 模式开始，逐步深度集成
4. **标准化优先**：优先采用 OpenTelemetry 语义约定，降低学习成本

### 7.3 下一步行动

1. **立即**：评审本报告，确认架构决策
2. **本周**：Hermes 团队评估 `hermes-trace-sdk` 侵入性
3. **下周**：启动 Python SDK 原型开发
4. **两周内**：Collector Adapter 框架 + 联合测试

---

## 附录

### A. 参考文件

- `/docs/TECHNICAL_DESIGN.md` - Crabagent 技术设计
- `/packages/openclaw-trace-plugin/config.ts` - 插件配置
- `/Users/lucbine/www/openclaw/extensions/diagnostics-otel/src/service.ts` - OpenClaw OTEL 实现
- `/Users/lucbine/www/hermes-agent/run_agent.py` - Hermes 核心执行
- `/Users/lucbine/www/hermes-agent/hermes_logging.py` - Hermes 日志系统
- `/Users/lucbine/www/hermes-agent/gateway/session.py` - Hermes 会话管理

### B. 术语对照

| Crabagent | OpenClaw | Hermes-Agent |
|-----------|----------|--------------|
| trace_root_id | runId / sessionKey | session_id (需生成) |
| session_id | sessionId | session_id |
| turn | llm_input/output | conversation round |
| tool_call | before/after_tool_call | _invoke_tool() |
| compaction | before/after_compaction | _compress_context() |

---

*报告完成*
