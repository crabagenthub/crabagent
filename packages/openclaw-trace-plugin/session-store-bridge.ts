/**
 * 借鉴 coze-openclaw-plugin `session-recovery`：解析 OpenClaw `agents/main/sessions` 路径，
 * 读 `sessions.json`，按 `sessionId` 反查 store 里的 `sessionKey`，写入同一份 pending，缓解 hook ctx 键与 store 键不一致导致的丢数。
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

export type OpenClawSessionEntry = {
  sessionId?: string;
  sessionFile?: string;
  deliveryContext?: { channel?: string; to?: string; accountId?: string };
};

export type OpenClawSessionStore = Record<string, OpenClawSessionEntry>;

/**
 * 与 coze `session-recovery` 同序：runtime.resolvePath → OPENCLAW_STATE_DIR → workspace 父目录 → 容器默认。
 * @param agentId 默认 `main`；子 agent（如 `email_automatic`）对应 `agents/<id>/sessions`。
 * @param api 宿主注入的 `OpenClawPluginApi`（或仅含 `runtime` / `config` 的测试桩）。
 */
export function resolveOpenClawSessionsBasePathForAgent(api: unknown, agentId?: string): string | null {
  const aid = agentId?.trim() || "main";
  const rel = `agents/${aid}/sessions`;
  const a =
    api != null && typeof api === "object" && !Array.isArray(api) ? (api as OpenClawPluginApi) : ({} as OpenClawPluginApi);
  const runtime = a.runtime;
  if (typeof runtime?.resolvePath === "function") {
    try {
      const p = runtime.resolvePath(rel)?.trim();
      if (p) {
        return p;
      }
    } catch {
      /* ignore */
    }
  }
  const stateDir = process.env.OPENCLAW_STATE_DIR?.trim();
  if (stateDir) {
    return path.join(stateDir, rel);
  }
  const cfg = a.config;
  const ws = cfg?.agents?.defaults?.workspace?.trim();
  if (ws) {
    return path.join(path.dirname(ws), rel);
  }
  return `/workspace/projects/${rel}`;
}

/** @deprecated 使用 {@link resolveOpenClawSessionsBasePathForAgent}(api, "main")；保留兼容导出。 */
export function resolveOpenClawSessionsBasePath(api: unknown): string | null {
  return resolveOpenClawSessionsBasePathForAgent(api, "main");
}

type SidIndexCache = {
  mtimeMs: number;
  /** sessionId → 该 id 在 store 中出现的所有 sessionKey */
  sidToStoreKeys: Map<string, string[]>;
};

const indexByBasePath = new Map<string, SidIndexCache>();

function buildSidToStoreKeys(store: OpenClawSessionStore): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const [storeKey, entry] of Object.entries(store)) {
    const sid = entry?.sessionId?.trim();
    if (!sid) {
      continue;
    }
    const list = m.get(sid) ?? [];
    if (!list.includes(storeKey)) {
      list.push(storeKey);
    }
    m.set(sid, list);
  }
  return m;
}

function loadSidIndex(basePath: string): Map<string, string[]> | null {
  const storePath = path.join(basePath, "sessions.json");
  let st: { mtimeMs: number };
  try {
    st = statSync(storePath);
  } catch {
    return null;
  }
  const cached = indexByBasePath.get(basePath);
  if (cached && cached.mtimeMs === st.mtimeMs) {
    return cached.sidToStoreKeys;
  }
  let raw: string;
  try {
    raw = readFileSync(storePath, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as OpenClawSessionStore;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const sidToStoreKeys = buildSidToStoreKeys(parsed as OpenClawSessionStore);
  indexByBasePath.set(basePath, { mtimeMs: st.mtimeMs, sidToStoreKeys });
  return sidToStoreKeys;
}

/** 返回与 `sessionId` 关联的 OpenClaw store 键（用于 mergePendingContext）。 */
export function sessionStoreKeysForSessionId(basePath: string, sessionId: string): string[] {
  const sid = sessionId.trim();
  if (!sid) {
    return [];
  }
  const idx = loadSidIndex(basePath);
  if (!idx) {
    return [];
  }
  return [...(idx.get(sid) ?? [])];
}
