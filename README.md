# Crabagent

OpenClaw 旁路 **Trace 采集**、**Collector** 与 **Web 控制台** monorepo。规格见 `docs/`。

## 包结构

| 路径 | 说明 |
|------|------|
| `packages/openclaw-trace-plugin` | 独立 npm 插件，经 `plugins.load.paths` 加载 |
| `services/collector` | HTTP API：`/v1/ingest`、SQLite、`/health` |
| `apps/web` | Next.js 控制台骨架（next-intl 中/英） |

## 开发

```bash
pnpm install --no-frozen-lockfile   # 若 CI 使用 frozen-lockfile，本地首次也需更新 lock
pnpm dev             # 并行：Collector + Web（推荐联调）
pnpm dev:collector   # 仅 Collector，默认 http://127.0.0.1:8787
pnpm dev:web         # 仅 Web，默认 http://127.0.0.1:3000，访问 /zh-CN 或 /en
pnpm build
pnpm smoke           # 自动起临时 Collector（随机端口 + 临时 DB）→ ingest → 拉列表，无需手工起服务
```

### 一键写入 OpenClaw 配置（需你确认后执行）

先看将要合并的内容（不写盘）：

```bash
pnpm openclaw:merge-config
# 可选：export CRABAGENT_COLLECTOR_URL=... CRABAGENT_COLLECTOR_API_KEY=...
```

确认无误后写入 `~/.openclaw/openclaw.json`（会先备份 `.bak.<时间戳>`）：

```bash
pnpm openclaw:merge-config -- --write
```

然后**请你本地重启 OpenClaw Gateway**。

Collector 示例：

```bash
export CRABAGENT_API_KEY=dev-local-key
pnpm dev:collector
```

插件包 **不**将 `openclaw` 作为 npm 依赖安装（避免拉取完整 OpenClaw 树）；类型检查使用 `stub/openclaw-plugin-sdk-core.ts`。运行时由已安装的 OpenClaw 解析真实的 `openclaw/plugin-sdk/core`。

## 与全局 OpenClaw 联调

1. 类型检查：`pnpm --filter @crabagent/openclaw-trace-plugin run typecheck`（可选）；宿主通常直接加载插件目录下的 `index.ts`。
2. 在 `~/.openclaw/openclaw.json` 中设置 `plugins.load.paths` 指向  
   `/Users/<you>/www/crabagent/packages/openclaw-trace-plugin`
3. 启用插件条目并配置，例如：

```json
{
  "plugins": {
    "load": {
      "paths": ["/absolute/path/to/crabagent/packages/openclaw-trace-plugin"]
    },
    "entries": {
      "openclaw-trace-plugin": {
        "enabled": true,
        "config": {
          "collectorBaseUrl": "http://127.0.0.1:8787",
          "collectorApiKey": "dev-local-key"
        }
      }
    }
  }
}
```

4. 若你配置了 `plugins.allow`（非空白名单），必须把 **`openclaw-trace-plugin`** 加进列表，否则工作区插件会被禁用；`pnpm openclaw:merge-config -- --write` 会自动追加。
5. 启动 Collector（需与 `collectorApiKey` 一致，环境变量 `CRABAGENT_API_KEY`）。
6. 重启 OpenClaw Gateway。

### 配置告警说明

- **`plugin id mismatch`**：清单 **`id`** 与包名推导的 **idHint** 须一致或符合 OpenClaw 兼容规则。本插件清单 id 为 **`openclaw-trace-plugin`**（与 `@crabagent/openclaw-trace-plugin` 的 unscoped 名相同）。`plugins.entries` 与 **`plugins.allow`**（若使用 allow）均使用 **`openclaw-trace-plugin`**；合并脚本会移除旧的 **`crabagent-trace`** / **`openclaw-trace`**。
- **`definePluginEntry is not a function`**：插件已改为**不**从 `openclaw/plugin-sdk/core` 导入（避免网关 jiti 互操作问题），请更新 crabagent 代码后重启网关。
- **`not in allowlist`**：在 **`plugins.allow`** 中加入 **`openclaw-trace-plugin`**，或重新运行合并脚本。

## 文档

- [文档索引](docs/README.md)
