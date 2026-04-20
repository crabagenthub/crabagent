import type { OpikBatchPayload } from "./opik-types.js";

export function mergeOpikBatches(batches: OpikBatchPayload[]): OpikBatchPayload {
  const out: OpikBatchPayload = {
    threads: [],
    traces: [],
    spans: [],
    attachments: [],
    feedback: [],
  };
  for (const b of batches) {
    if (b.threads?.length) {
      out.threads!.push(...b.threads);
    }
    if (b.traces?.length) {
      out.traces!.push(...b.traces);
    }
    if (b.spans?.length) {
      out.spans!.push(...b.spans);
    }
    if (b.attachments?.length) {
      out.attachments!.push(...b.attachments);
    }
    if (b.feedback?.length) {
      out.feedback!.push(...b.feedback);
    }
  }
  return out;
}

export async function postOpikBatch(
  baseUrl: string,
  apiKey: string,
  body: OpikBatchPayload,
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `${baseUrl.replace(/\/+$/, "")}/v1/opik/batch`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text };
}
