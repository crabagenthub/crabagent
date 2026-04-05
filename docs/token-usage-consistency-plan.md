# Token 数据校对与一致性改造计划

本文档汇总 **产品口径**、**当前实现中的计算公式**、**已知不一致与根因**、**改造方向与验收标准**，供评审。  
（关联代码：`apps/web` 会话/消息/执行步骤相关 UI，以及 Collector 中 thread、span、trace 的 token SQL；仅为计划说明。）

---

## 1. 目标

1. **会话级**：同一 `thread_id` 在 **列表**（如线程表 `total_tokens`）与 **详情/抽屉**（侧栏 Token 区）展示的 token 含义一致、可解释。
2. **消息/轮次级**：左侧「用户消息轮次」与右侧详情、时间轴聚合规则一致；**总计 = input + output**，**cache 仅展示**；各端展示可对账（见 §2.2）。
3. **子代理**：同时支持 **本会话** 与 **含子代理** 两套数字（你已确认 **两个都展示**），避免全局统计 **重复计入**。
4. **仅有 total、无分项** 的上游数据：界面不误导（避免出现「总计很大、input/output 全 0」却当作真实分项）。
5. **执行步骤（Span）**：观测列表「执行步骤」Tab 的 **列表列 `total_tokens`** 与同一条 Span 在 **详情/检查弹窗/语义树/调用图** 中的 token 展示 **可对账、含义一致**（展示规则与 §2.2、§2.3 一致）。

---

## 2. 产品口径（已定）

### 2.1 子代理与会话

| 指标 | 含义 | 是否含子代理 thread |
|------|------|---------------------|
| **本会话（thread 原生）** | 当前 `thread_id` 内落库事件/span 汇总的 token | **否**（仅本 thread） |
| **含子代理（归因/端到端）** | 为完成该用户轮次而发生的总成本（父 + 链接到的子会话） | **是**（在展示层或专用字段 roll-up） |

**原则**：

- **事实来源**：LLM 消耗发生在哪个 thread，就应能在该 thread 的详情里核对。
- **父轮展示**：同时展示「本会话」与「含子代理」时，**文案分开展示**，避免与列表单列混用同一标签。
- **全局/工作区大盘**：按 **span/trace 去重** 或明确规则（例如只按 thread 加总且子 thread 不参与父 thread 的重复加总），防止父子双计。

### 2.2 分项与总计（产品定稿）

**总计（用于可加性核对、与「总 token」主数字对齐）**：

- **总计** = `prompt/input` + `completion/output`（或等价字段名）。

**缓存（展示用）**：

- **`cache_read`（及同类缓存命中字段）仅作展示**，**不计入**上述「总计」公式；UI 可单独一行展示「缓存命中」，避免与「总 token」混加导致 **double-count** 或与供应商 `total_tokens` 定义冲突。

当 **仅有上游 `total_tokens`、无法解析 input/output** 时：

- **不应** 把「无法解析」与「真实为 0」混用：无法解析时对应格显示 **「—」**，并可用 Tooltip/脚注说明 **「未分项」**；**能解析为 0** 则显示 **0**。
- **总计** 仍可单独一行展示显式 total；与 input/output 不可加时，依赖 **「未分项」** 说明而非隐藏总计。

### 2.3 明细（分项）展示规则

**无论 input / output（及 cache）数值是否为 0，明细行都要展示**（会话侧栏、`TokenUsageDetailsCard`、检查弹窗、轮次 Popover 等同理）：

- **固定展示** 输入、输出、缓存命中（若产品包含该维度）、**总计** 等约定列，**不因全为 0 而收起或省略**。
- **语义区分**：**真实聚合结果为 0** → 显示 **`0`**；**上游未提供或无法解析** → 显示 **「—」**，并配合 §2.2 的「未分项」说明（避免用户以为 0+0=大总计）。

---

## 3. 当前实现中的计算公式（代码层）

### 3.1 从单条 `llm_output` 事件解析 usage

**文件**：[apps/web/src/lib/trace-payload-usage.ts](apps/web/src/lib/trace-payload-usage.ts)

- `usageFromTracePayload(payload)`：依次尝试 `payload.usage`、`payload.usageMetadata`、`crabagent` 嵌套的 `reasoning.tokenMetrics` 等，得到 `prompt`、`completion`、`total`（可空）、`cacheRead`。

### 3.2 会话级：时间线全量 `llm_output` 聚合

**文件**：同上，`aggregateThreadLlmOutputUsage(events)`

对全部 `type === "llm_output"` 的事件：

- `prompt` / `completion` / `cacheRead`：逐项累加解析结果。
- **显式 total**：若单条解析出 `total > 0`，则计入 `explicitTotalSum` / `explicitTotalRows`。
- **displayTotal**（**当前实现**）：
  - 若 `prompt + completion + cacheRead > 0` → **displayTotal = 三者之和**；
  - 否则若存在显式 total 行 → **displayTotal = 各条显式 total 之和**。

**与 §2.2 产品口径的差异（实现阶段需改）**：产品要求 **总计 = prompt + completion**，**不含 cacheRead**；当前聚合把 **cache 叠进 displayTotal**，需改为 **分项展示 cache**、**合计仅 input+output**（或与显式 `total_tokens` 回退规则统一，见阶段 A）。

**含义**：当上游只给 **total**、不给分项时，会话级仍可能得到 **很大的 displayTotal**，但 **prompt/completion 累加仍为 0**。

### 3.3 轮次级：与「回合时间窗口」一致的聚合

**文件**：[apps/web/src/lib/user-turn-list.ts](apps/web/src/lib/user-turn-list.ts) — `inferTurnWindowMetrics(windowEvents)`

逻辑与 `aggregateThreadLlmOutputUsage` **同构**（只对窗口内 `llm_output` 累加），得到 `TurnWindowMetrics`：`promptTokens`、`completionTokens`、`cacheReadTokens`、`displayTotal`。

**抽屉内**：对每个 listKey 用 `buildConversationTurnWindowEvents` 切片后再 `inferTurnWindowMetrics`（见 [thread-conversation-drawer.tsx](apps/web/src/components/thread-conversation-drawer.tsx)）。

### 3.4 会话列表 `total_tokens`（Collector SQL）

**文件**：[services/collector/src/thread-records-query.ts](services/collector/src/thread-records-query.ts) + [services/collector/src/opik-tokens-sql.ts](services/collector/src/opik-tokens-sql.ts)

- 对每个 trace 用 `TRACE_ROW_TOKEN_INTEGER_EXPR`：**优先** metadata / output 上的 **显式 total**，再 **prompt+completion**，再 span 汇总等（长链 COALESCE）。
- 线程列 `total_tokens` = 该线程下各 trace 上式的 **SUM**。

**含义**：列表上的总数可能与 **仅按时间线 `llm_output` payload 聚合** 的结果在边界情况下不完全相同（例如 metadata 有 total、事件 payload 未带分项）。

### 3.5 侧栏展示（会话详情头）

**文件**：[apps/web/src/components/thread-conversation-inspect-header.tsx](apps/web/src/components/thread-conversation-inspect-header.tsx)

- 当有 `llm_output` 事件时：input/output/cache 取自 **聚合的 prompt/completion/cacheRead**；总计优先 **displayTotal**，否则分项和，否则回退 **列表行 `listTotalTokens`**。

**问题点**：当 **displayTotal 来自「仅显式 total」** 而 **prompt/completion 仍为 0** 时，界面会呈现 **总计 ≠ input+output**（与 §2.2 可加关系冲突）；**cache** 应独立展示，**不参与**总计核对。

### 3.6 轮次列表行与 Token 卡片

**文件**：

- [apps/web/src/components/thread-conversation-drawer.tsx](apps/web/src/components/thread-conversation-drawer.tsx) — 主数字用 `displayTotal` 或分项和（**当前**分项和含 cache 时与 §2.2 不一致，需对齐为 **pt+ct**）；`pt/ct` 在 **均为 number** 时显示比例（**0 与 0 也会显示 0/0**）。
- [apps/web/src/lib/span-token-display.ts](apps/web/src/lib/span-token-display.ts) — `turnWindowTokenEntries`：把轮次指标转成 `TokenUsageDetailsCard` 的 `entries`；**当前未把 `displayTotal` 写入 `total_tokens` 键**。
- `normalizeTokenUsageEntriesForDisplay`：若存在 `prompt_tokens`/`completion_tokens` 键，则 **把 `total_tokens` 重写为 prompt+completion**，**不保留**仅来自显式 total 的合计。

**问题点**：主行显示大总计，Popover 内可能被规范成 **0**，与 **0/0** 并列，造成 **列表/浮层自相矛盾**。

### 3.7 执行步骤：列表页与详情页（Span 级）

**列表（观测 → 执行步骤）**

- **文件**：[apps/web/src/components/spans-data-table.tsx](apps/web/src/components/spans-data-table.tsx)
- **数据**：行类型来自 Collector `span-records`（见 [services/collector/src/span-records-query.ts](services/collector/src/span-records-query.ts)），列 **`total_tokens`** 由 `SPAN_ROW_TOKEN_INTEGER_EXPR`（[opik-tokens-sql.ts](services/collector/src/opik-tokens-sql.ts)）对 **单条 span 的 `usage_json` / `output_json` 等** 做 COALESCE 估算。
- **含义**：与线程列表类似，**优先显式 total**，否则 **prompt+completion** 等链式回退。

**详情 / 检查（同一 trace 下的 Span）**

| 入口 | 文件 | Token 计算/展示要点 |
|------|------|---------------------|
| Trace/Span 检查弹窗 | [trace-record-inspect-dialog.tsx](apps/web/src/components/trace-record-inspect-dialog.tsx) | 选中 Span 用 **`spanTokenTotals(selectedSpan)`**（[span-token-display.ts](apps/web/src/lib/span-token-display.ts)）；分项为 `prompt_tokens`/`completion_tokens`/`cache_read_tokens`；**总计**优先 `displayTotal`，否则回退 **行上 `row.total_tokens`**（列表同源字段）。 |
| Span 行抽屉（语义树） | [span-record-inspect-drawer.tsx](apps/web/src/components/span-record-inspect-drawer.tsx) | 侧栏 **`semanticSpanTokenEntries(selectedSpan)`** → `TokenUsageDetailsCard`（与语义树字段一致）。 |
| 语义树节点 | [trace-semantic-tree.tsx](apps/web/src/components/trace-semantic-tree.tsx) | 节点行 `spanTokenTotals` + `TokenUsagePopover` / `semanticSpanTokenEntries`。 |
| 调用图节点 | [execution-trace-flow.tsx](apps/web/src/components/execution-trace-flow.tsx) | 节点详情里展示 **`d.total_tokens`**（执行图 DTO，需与后端图构建时取自 span 的规则一致）。 |
| 消息详情 · 执行步骤视图 | [messages/[messageId]/page.tsx](apps/web/src/app/[locale]/messages/[messageId]/page.tsx) | `ExecutionTraceFlow` + 语义树切换，与上列同源。 |

**`spanTokenTotals`（Span 行）公式摘要**（与线程时间线聚合 **不同源**）：

- `prompt` / `completion` / `cacheRead`：来自 **语义 Span 行字段**（及可选 `usage_breakdown`）。
- `displayTotal`（**当前实现**）：**优先**行上显式 `total_tokens`，**否则** `prompt + completion + cacheRead`（有任一分项为正时）。**产品口径**：「可核对总计」应为 **prompt + completion**；**cache** 单独展示（实现阶段对齐 `spanTokenTotals` / `semanticSpanTokenEntries`）。

**与 3.6 相同的结构性风险**：若 **`total_tokens` 仅来自 COALESCE 链中的「显式 total」**，而 **`prompt_tokens`/`completion_tokens` 解析为 0**，则 **`spanTokenTotals.displayTotal`** 可能为 **大数**，**分项仍为 0** → 检查弹窗里 **输入/输出/缓存为 0、总计为大**（与 `ThreadConversationInspectHeader` 同类问题）。`TokenUsageDetailsCard` 经 **`normalizeTokenUsageEntriesForDisplay`** 时，若带 0 分项键，也可能把 **total 压成 0**。

**独立路由 `steps/[stepId]`**

- **文件**：[apps/web/src/app/[locale]/steps/[stepId]/page.tsx](apps/web/src/app/[locale]/steps/[stepId]/page.tsx)
- **现状**：部分为 **mock** 数据；真实路径应以 **`loadSemanticSpans` + 当前 `stepId` 对应 span** 与观测详情 **对齐**。纳入校对范围：**接真实 API 后**，列表/详情/本页三者 **同一 `span_id` 的 token 一致**。

---

## 4. 已知问题归纳（与截图现象一致）

1. **显式 total 与分项脱节**：`usage` 只有 `total_tokens` 时，`displayTotal` 很大，但 prompt/completion 为 0 → 侧栏「总计」与「输入/输出」不满足 **总计 = input + output**；**cache** 若单独有值，按 §2.2 **不计入总计**，仅作展示。
2. **0/0 比例误导**：`typeof pt === "number" && typeof ct === "number"` 在 **0** 时为真，轮次行显示 **34840** 与 **0/0**。
3. **turnWindowTokenEntries + normalize**：显式 total 未进入 `entries`，且 normalize 把 total 压成 **prompt+completion=0** → **Popover 与主数字不一致**。
4. **列表 SQL vs 事件聚合**：线程 `total_tokens` 与 `aggregateThreadLlmOutputUsage` 数据源与优先级不同，**边界情况可能不一致**（需抽样对齐或统一数据源）。
5. **执行步骤列表 vs 详情**：`spans-data-table` 的 **`total_tokens`**（SQL 表达式）与 **`spanTokenTotals` / `semanticSpanTokenEntries`**（字段 + breakdown）在 **仅 total、无分项** 时同样会出现 **总计与分项脱节**；**`normalizeTokenUsageEntriesForDisplay`** 在 Span 卡片上可能 **覆盖 total**。
6. **调用图**：`execution-trace-flow` 节点若 **仅带 `total_tokens` 标量**，需与 **同 span 在语义树/检查弹窗** 的数字一致；后端 `execution-graph` 查询与 `usage_json` 解析需与 **span-records** 同源或文档说明差异。

---

## 5. 改造方向（建议分阶段）

### 阶段 A — 前端一致性与可解释性（优先）

1. **侧栏**（`ThreadConversationInspectHeader`）：**input / output / cache / 总计** 等明细行 **始终渲染**（§2.3）；当 **有显式总计但分项无法解析** 时，对应格用 **「—」** +「未分项」说明；**真实为 0** 则显示 **0**（与 §2.2 一致）。
2. **轮次列表行**（`thread-conversation-drawer`）：仅当 **`(pt+ct) > 0`** 时显示 **pt/ct** 比例（**cache 不参与**比例行）；否则不显示 **0/0**。
3. **turnWindowTokenEntries / normalize**：
   - 要么在 **仅有 displayTotal** 时向 `entries` 写入 **`total_tokens`** 且 **不写零分项**，避免 normalize 把 total 抹成 0；
   - 要么调整 **normalizeTokenUsageEntriesForDisplay**：当 `prompt+completion=0` 且存在可信的 `total_tokens` 时 **不覆盖** total。
4. **文档/Tooltip**：简短说明「会话列表 total 来自 trace 元数据与 span 回退；抽屉内来自时间线 llm_output」的差异（若短期保留双源）。

5. **执行步骤（与阶段 A 同一套展示规则）**  
   - **检查弹窗**（`TraceRecordInspectDialog`）：与 **会话侧栏** 一致，**明细行始终展示**（§2.3）；区分 **「—」**（未解析）与 **0**（真实为零）。  
   - **语义树 / Span 抽屉**（`trace-semantic-tree`、`SpanRecordInspectDrawer`）：**`semanticSpanTokenEntries` + `normalizeTokenUsageEntriesForDisplay`** 按上节修正，避免 **Popover/卡片 total 被抹成 0**。  
   - **调用图**（`ExecutionTraceFlow`）：核对节点 **`total_tokens`** 与 **同 trace 下 semantic spans** 是否一致；必要时在 **execution-graph 后端** 与 **span-records** 对齐字段来源。  
   - **`steps/[stepId]` 页面**：落地真实数据后，与 **观测列表点入的同一 span** 做 **golden 用例** 对照。

### 阶段 B — 子代理双指标（产品已选「两个都展示」）

1. 在 **数据模型/API** 或 **前端** 根据 `thread` 父子关系（已有 subagent drill / metadata）计算：
   - **本会话** token；
   - **含子代理** token（子 `thread_id` 聚合之和）。
2. UI：分开展示两行或两列标签，避免与单列 `total_tokens` 混用。

### 阶段 C — 采集/入库（可选，治本）

1. 在 **openclaw-trace-plugin / collector** 侧，对仅含 total 的响应尽量 **补全 prompt/completion**（若 provider 可推导）。
2. 延续 [opik-batch-ingest](services/collector/src/opik-batch-ingest.ts) 中 **merge 保留 usage** 的思路，避免批次合并把分项冲掉。

---

## 6. 验收标准（建议）

- [ ] **总计定义**：各页「总 token」与 **input + output** 一致（**cache 不计入总计**）；cache 单独展示时有明确标签。
- [ ] **明细始终展示**：凡提供 Token 明细的区域，**input / output / cache（若有）/ 总计** 等行 **一律展示**；值为 **0** 与 **「—」** 的语义符合 §2.3。
- [ ] 同一 thread：列表 `total_tokens` 与抽屉会话级展示 **在文档中定义的规则下** 一致，或 **明确标注差异原因**（双源时）。
- [ ] 任意轮次：**主数字、Popover、侧栏** 不出现「总计很大 + input/output 全 0」却当作真实分项；若有则带 **未分项** 说明。
- [ ] 不再出现 **总计与 Popover 内 total 相反**（大数 vs 0）的情况。
- [ ] 子代理场景：**本会话** 与 **含子代理** 可同时展示，全局统计不出现 **父子重复加计**（需在报表层约定一种汇总方式）。
- [ ] **执行步骤**：同一 `span_id` 在 **观测列表 `total_tokens` 列**、**检查弹窗/抽屉/语义树节点**、**调用图节点**（若展示 token）三者 **一致或可解释差异**（双源时 Tooltip/文档）。
- [ ] **执行步骤**：不存在 **列表为大数、详情 Popover/卡片 total 为 0** 的回归。

---

## 7. 风险与待办

- **回合时间窗口**与 **全会话聚合** 在首尾锚点边界上是否完全划分所有 `llm_output`，需用多样本回归（`buildConversationTurnWindowEvents` vs 全量 merged）。
- **子代理 thread** 与父 thread 的 **链接字段** 以何为准（metadata / parent thread id）需在实现子阶段对照现有 ingest 字段。
- **执行图 API**（[execution-graph-query](services/collector/src/execution-graph-query.ts) 等）中节点 token 与 **span 表** 是否同一套解析，需在联调时确认。

---

## 8. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-04-05 | 初稿：合并技术排查结论与产品口径（含子代理双指标：本会话 + 含子代理） |
| 2026-04-05 | 增补：执行步骤列表（`spans-data-table`）与详情（检查弹窗、语义树、调用图、`steps/[stepId]`）校对范围与验收项 |
| 2026-04-05 | 产品口径：**总计 = prompt/input + completion/output**；**cache_read 仅展示、不计入总计**；标注与当前代码差异 |
| 2026-04-05 | §2.3：**无论 input/output 是否为 0，明细均展示**；区分 **0** 与 **「—」**（未解析） |
| 2026-04-05 | **已落地（前端）**：`aggregateThreadLlmOutputUsage` / `inferTurnWindowMetrics` 总计改为 **prompt+completion**；`breakdownUnknown`；`spanTokenTotals` / `semanticSpanTokenEntries` / `turnWindowTokenEntries` / `normalizeTokenUsageEntriesForDisplay`；会话头、抽屉轮次、检查弹窗、语义树、属性面板等与计划对齐（阶段 B/C 未做） |
