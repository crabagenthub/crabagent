const URL_KEY = "crabagent_collector_url";
const API_KEY_KEY = "crabagent_api_key";
const WORKSPACE_KEY = "crabagent_workspace_name";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isHttpLoopbackUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr.trim());
    return u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/**
 * 开发态：页面与 Collector URL 同为 loopback，但 hostname 一个是 `localhost`、一个是 `127.0.0.1` 时，
 * Chrome PNA 会把跨主机请求打成 `TypeError: Failed to fetch`（与 Collector 是否启动无关）。
 * 此时强制走 Next 同源代理。
 */
function devUseSameOriginCollectorProxy(stored: string): boolean {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined") {
    return false;
  }
  if (!isHttpLoopbackUrl(stored) || !LOOPBACK_HOSTS.has(window.location.hostname)) {
    return false;
  }
  try {
    return new URL(stored.trim()).hostname !== window.location.hostname;
  } catch {
    return false;
  }
}

export function loadCollectorUrl(): string {
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_COLLECTOR_URL?.trim() || "http://127.0.0.1:8787";
  }
  const stored = window.localStorage.getItem(URL_KEY)?.trim();
  if (stored) {
    if (devUseSameOriginCollectorProxy(stored)) {
      return `${window.location.origin.replace(/\/+$/, "")}/api/collector`;
    }
    return stored;
  }
  const fromEnv = process.env.NEXT_PUBLIC_COLLECTOR_URL?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  /** 开发环境默认走 Next 同源代理，避免浏览器拦截 localhost → 127.0.0.1 的跨站请求（含 Chrome PNA）。 */
  if (process.env.NODE_ENV === "development") {
    return `${window.location.origin.replace(/\/+$/, "")}/api/collector`;
  }
  return "http://127.0.0.1:8787";
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
