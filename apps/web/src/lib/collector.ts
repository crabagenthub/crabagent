const URL_KEY = "crabagent_collector_url";
const API_KEY_KEY = "crabagent_api_key";
const WORKSPACE_KEY = "crabagent_workspace_name";

const DEFAULT_COLLECTOR_URL = "http://127.0.0.1:8087";

/**
 * 清除 localStorage 里曾保存的 Next 同源 `/api/collector` 代理根路径，避免继续打到已移除的代理。
 */
function stripObsoleteNextCollectorProxyFromStorage(stored: string): string {
  if (!stored || typeof window === "undefined") {
    return stored;
  }
  try {
    const u = new URL(stored.trim(), window.location.origin);
    if (u.origin !== window.location.origin) {
      return stored;
    }
    const p = u.pathname.replace(/\/+$/, "") || "/";
    if (p === "/api/collector" || p.startsWith("/api/collector/")) {
      window.localStorage.removeItem(URL_KEY);
      return "";
    }
  } catch {
    return stored;
  }
  return stored;
}

/**
 * 浏览器端 Collector 根地址：优先 `NEXT_PUBLIC_COLLECTOR_URL`，否则为设置里保存的 URL，最后默认直连 iseeagentc（`DEFAULT_COLLECTOR_URL`）。
 */
export function loadCollectorUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_COLLECTOR_URL?.trim();
  if (typeof window === "undefined") {
    return fromEnv || DEFAULT_COLLECTOR_URL;
  }
  if (fromEnv) {
    return fromEnv;
  }
  const storedRaw = window.localStorage.getItem(URL_KEY)?.trim() ?? "";
  const cleaned = stripObsoleteNextCollectorProxyFromStorage(storedRaw);
  if (cleaned) {
    return cleaned;
  }
  return DEFAULT_COLLECTOR_URL;
}

export function saveCollectorUrl(url: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(URL_KEY, url.trim());
}

export function loadApiKey(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.localStorage.getItem(API_KEY_KEY) ?? "";
}

export function saveApiKey(key: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(API_KEY_KEY, key.trim());
}

export function clearApiKey(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(API_KEY_KEY);
}

export function collectorAuthHeaders(apiKey: string): HeadersInit {
  const h: Record<string, string> = {};
  if (apiKey.trim()) {
    h["x-api-key"] = apiKey.trim();
    h.authorization = `Bearer ${apiKey.trim()}`;
  }
  return h;
}

export function loadWorkspaceName(): string {
  if (typeof window === "undefined") {
    return "OpenClaw";
  }
  const raw = window.localStorage.getItem(WORKSPACE_KEY);
  const t = String(raw ?? "").trim();
  const v = t.toLowerCase();
  return v === "hermes-agent" ? "Hermes-Agent" : "OpenClaw";
}

export function appendWorkspaceNameParam(sp: URLSearchParams, workspaceName?: string): void {
  const ws = String(workspaceName ?? loadWorkspaceName()).trim();
  if (!ws) {
    return;
  }
  sp.set("workspace_name", ws);
}

/** `threadKey` = conversation aggregate id (session_key → session_id → trace_root_id), same as list rows. */
export function streamUrl(baseUrl: string, threadKey: string, apiKey: string): string {
  const b = baseUrl.replace(/\/+$/, "");
  const q = apiKey.trim() ? `?token=${encodeURIComponent(apiKey.trim())}` : "";
  return `${b}/v1/traces/${encodeURIComponent(threadKey)}/stream${q}`;
}
