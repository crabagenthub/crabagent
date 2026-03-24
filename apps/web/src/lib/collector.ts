const URL_KEY = "crabagent_collector_url";
const API_KEY_KEY = "crabagent_api_key";

export function loadCollectorUrl(): string {
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_COLLECTOR_URL ?? "http://127.0.0.1:8787";
  }
  return (
    window.localStorage.getItem(URL_KEY) ??
    process.env.NEXT_PUBLIC_COLLECTOR_URL ??
    "http://127.0.0.1:8787"
  );
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

/** `threadKey` = conversation aggregate id (session_key → session_id → trace_root_id), same as list rows. */
export function streamUrl(baseUrl: string, threadKey: string, apiKey: string): string {
  const b = baseUrl.replace(/\/+$/, "");
  const q = apiKey.trim() ? `?token=${encodeURIComponent(apiKey.trim())}` : "";
  return `${b}/v1/traces/${encodeURIComponent(threadKey)}/stream${q}`;
}
