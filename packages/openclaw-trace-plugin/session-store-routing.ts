/**
 * 在不修改 OpenClaw 的前提下，从本机 `agents/<agentId>/sessions/sessions.json` 读取与控制台会话表同源的 SessionEntry，
 * 经 `extractLlmInputRoutingMeta` 并入 `openclaw_routing`（与 hook 内 `openclawSession` 方案字段对齐）。
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { extractLlmInputRoutingMeta } from "./llm-input-routing-meta.js";
import { parseRoutingKindFromSessionKey } from "./trace-session-key.js";

type StoreCache = { mtimeMs: number; store: Record<string, Record<string, unknown>> };

const storeCacheByBasePath = new Map<string, StoreCache>();

function loadSessionStore(basePath: string): Record<string, Record<string, unknown>> | null {
  const storePath = path.join(basePath, "sessions.json");
  let st: { mtimeMs: number };
  try {
    st = statSync(storePath);
  } catch {
    return null;
  }
  const cached = storeCacheByBasePath.get(basePath);
  if (cached && cached.mtimeMs === st.mtimeMs) {
    return cached.store;
  }
  let raw: string;
  try {
    raw = readFileSync(storePath, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const store = parsed as Record<string, Record<string, unknown>>;
  storeCacheByBasePath.set(basePath, { mtimeMs: st.mtimeMs, store });
  return store;
}

function findStoreEntry(
  store: Record<string, Record<string, unknown>>,
  candidates: string[],
): { entry: Record<string, unknown>; matchedKey: string } | undefined {
  const keys = [...new Set(candidates.map((k) => k.trim()).filter(Boolean))];
  for (const k of keys) {
    const e = store[k];
    if (e && typeof e === "object" && !Array.isArray(e)) {
      return { entry: e as Record<string, unknown>, matchedKey: k };
    }
  }
  const lowered = new Set(keys.map((k) => k.toLowerCase()));
  for (const key of Object.keys(store)) {
    if (lowered.has(key.toLowerCase())) {
      const e = store[key];
      if (e && typeof e === "object" && !Array.isArray(e)) {
        return { entry: e as Record<string, unknown>, matchedKey: key };
      }
    }
  }
  return undefined;
}

/** 对齐 OpenClaw `classifySessionKey` 的轻量版（仅用于展示 kind）。 */
export function classifyKindFromStoreEntry(sessionKey: string, entry: Record<string, unknown>): string {
  const k = sessionKey.trim();
  if (k === "global") {
    return "global";
  }
  if (k === "unknown") {
    return "unknown";
  }
  const ct = entry.chatType;
  if (ct === "group" || ct === "channel") {
    return "group";
  }
  if (k.includes(":group:") || k.includes(":channel:")) {
    return "group";
  }
  const fromAgent = parseRoutingKindFromSessionKey(k);
  if (fromAgent) {
    return fromAgent;
  }
  return "direct";
}

/**
 * 将磁盘 SessionEntry 打成与 OpenClaw `openclawSession` 快照同构的扁平原对象，再走 `extractLlmInputRoutingMeta`。
 */
export function buildOpenclawSessionShapeFromStoreEntry(
  canonicalKey: string,
  entry: Record<string, unknown>,
): Record<string, unknown> {
  const kind = classifyKindFromStoreEntry(canonicalKey, entry);
  const base: Record<string, unknown> = {
    sessionKey: canonicalKey.trim(),
    kind,
  };
  const label = typeof entry.label === "string" ? entry.label.trim() : "";
  if (label.length > 0) {
    base.label = label;
  }
  const tl = entry.thinkingLevel;
  if (typeof tl === "string" && tl !== "") {
    base.thinkingLevel = tl;
  }
  if (typeof entry.fastMode === "boolean") {
    base.fastMode = entry.fastMode;
  }
  const vl = entry.verboseLevel;
  if (typeof vl === "string" && vl !== "") {
    base.verboseLevel = vl;
  }
  const rl = entry.reasoningLevel;
  if (typeof rl === "string" && rl !== "") {
    base.reasoningLevel = rl;
  }
  const ctxTok = entry.contextTokens;
  if (typeof ctxTok === "number" && Number.isFinite(ctxTok) && ctxTok > 0) {
    base.contextTokens = Math.trunc(ctxTok);
  }
  const tt = entry.totalTokens;
  if (typeof tt === "number" && Number.isFinite(tt) && tt > 0) {
    base.totalTokens = Math.trunc(tt);
  }
  return base;
}

/**
 * @param basePath `…/agents/<agentId>/sessions`（不含 sessions.json）
 * @param sessionKeyCandidates ctx.sessionKey、store 反查键等，按顺序尝试精确/大小写不敏感匹配
 */
export function extractRoutingFromOpenClawSessionStore(
  basePath: string | null | undefined,
  sessionKeyCandidates: string[],
): Record<string, unknown> | undefined {
  const bp = basePath?.trim();
  if (!bp) {
    return undefined;
  }
  const store = loadSessionStore(bp);
  if (!store) {
    return undefined;
  }
  const found = findStoreEntry(store, sessionKeyCandidates);
  if (!found) {
    return undefined;
  }
  const shape = buildOpenclawSessionShapeFromStoreEntry(found.matchedKey, found.entry);
  return extractLlmInputRoutingMeta({ openclawSession: shape });
}
