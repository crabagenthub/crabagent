import type { SemanticSpanRow } from "@/lib/semantic-spans";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatBlock = { role: ChatRole; content: string };

function partToString(part: unknown): string {
  if (typeof part === "string") {
    return part;
  }
  if (part == null) {
    return "";
  }
  if (typeof part === "object" && !Array.isArray(part)) {
    const o = part as Record<string, unknown>;
    if (typeof o.text === "string") {
      return o.text;
    }
    if (typeof o.content === "string") {
      return o.content;
    }
  }
  try {
    return JSON.stringify(part, null, 2);
  } catch {
    return String(part);
  }
}

function contentToString(c: unknown): string {
  if (typeof c === "string") {
    return c;
  }
  if (Array.isArray(c)) {
    return c.map(partToString).filter(Boolean).join("\n");
  }
  return partToString(c);
}

function normalizeRole(r: string): ChatRole | null {
  const x = r.trim().toLowerCase();
  if (x === "system" || x === "user" || x === "assistant" || x === "tool") {
    return x;
  }
  return null;
}

function messagesFromArray(msgs: unknown): ChatBlock[] | null {
  if (!Array.isArray(msgs) || msgs.length === 0) {
    return null;
  }
  const out: ChatBlock[] = [];
  for (const m of msgs) {
    if (!m || typeof m !== "object" || Array.isArray(m)) {
      continue;
    }
    const o = m as Record<string, unknown>;
    const roleRaw = o.role;
    if (typeof roleRaw !== "string") {
      continue;
    }
    const role = normalizeRole(roleRaw);
    if (!role) {
      continue;
    }
    const content = contentToString(o.content ?? o.text ?? o.message);
    if (!content.trim()) {
      continue;
    }
    out.push({ role, content });
  }
  return out.length > 0 ? out : null;
}

/** Try OpenAI-style `messages` from span input. */
export function extractInputChatBlocks(input: Record<string, unknown>): ChatBlock[] | null {
  const direct =
    messagesFromArray(input.messages) ??
    messagesFromArray(input.history) ??
    messagesFromArray(input.conversation);
  if (direct) {
    return direct;
  }
  const body = input.body;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    const nested = messagesFromArray(b.messages) ?? messagesFromArray(b.history);
    if (nested) {
      return nested;
    }
  }
  const req = input.request;
  if (req && typeof req === "object" && !Array.isArray(req)) {
    const nested = messagesFromArray((req as Record<string, unknown>).messages);
    if (nested) {
      return nested;
    }
  }
  return null;
}

/** Assistant / model text from span output. */
export function extractOutputChatBlocks(output: Record<string, unknown>): ChatBlock[] {
  const texts = output.assistantTexts;
  if (Array.isArray(texts)) {
    const parts = texts.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    if (parts.length > 0) {
      return parts.map((content) => ({ role: "assistant" as const, content }));
    }
  }
  for (const k of ["text", "content", "message", "output", "answer"] as const) {
    const v = output[k];
    if (typeof v === "string" && v.trim()) {
      return [{ role: "assistant", content: v.trim() }];
    }
  }
  return [];
}

export function extractRunChatBlocks(span: SemanticSpanRow): { input: ChatBlock[]; output: ChatBlock[] } {
  const input = extractInputChatBlocks(span.input) ?? [];
  const output = extractOutputChatBlocks(span.output);
  return { input, output };
}
