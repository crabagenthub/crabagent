import type { QueuedEvent } from "./event-queue.js";

export async function postIngest(
  baseUrl: string,
  apiKey: string,
  events: QueuedEvent[],
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `${baseUrl.replace(/\/+$/, "")}/v1/ingest`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ events }),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}
