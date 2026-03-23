# Crabagent 文档索引

| 文档 | 说明 |
|------|------|
| [产品设计文档](./PRODUCT_DESIGN.md) | PRD：用户、场景、功能需求、非功能、路线图、术语 |
| [技术设计文档](./TECHNICAL_DESIGN.md) | TDD：组件、API 轮廓、数据模型、安全、部署、测试 |
| [架构与数据流](./architecture.md) | 架构定稿 v1.1、Mermaid 图、ingest/SSE/认证/上传策略 |
| [Token 优化策略](./product-token-optimization.md) | 商业化子产品说明与路线图 |
| [图源 `diagrams/`](./diagrams/) | `project-architecture.mmd`、`data-flow*.mmd` 等 |

**推荐阅读顺序**：产品设计 → 架构定稿 → 技术设计 → Token 优化（按需）。

## 代码仓库（实现）

| 路径 | 说明 |
|------|------|
| `packages/openclaw-trace-plugin` | OpenClaw 插件：Hooks + 内存队列 + ingest flush |
| `services/collector` | Hono + SQLite：`/health`、`/v1/ingest`、`/v1/traces` |
| `apps/web` | Next.js 15 + next-intl + TanStack Query 骨架 |

根目录 `README.md` 含联调步骤；`.npmrc` 中 `auto-install-peers=false` 避免安装可选 peer `openclaw`。
