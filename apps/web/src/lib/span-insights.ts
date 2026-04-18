import type { SemanticSpanRow } from "@/lib/semantic-spans";

/** ~500k UTF-16 units → warn as “large read” */
export const LARGE_IO_CHARS = 500_000;
function resolveLargeToolResultChars(): number {
  const raw = process.env.NEXT_PUBLIC_LARGE_TOOL_RESULT_CHARS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 8_192;
}
export const LARGE_TOOL_RESULT_CHARS = resolveLargeToolResultChars();

export function ioPathFromInput(input: Record<string, unknown>): string | null {
  const p = input.path ?? input.filePath ?? input.file_path ?? input.uri;
  if (typeof p === "string" && p.trim()) {
    return p.trim();
  }
  const pr = input.params;
  if (pr && typeof pr === "object" && !Array.isArray(pr)) {
    const o = pr as Record<string, unknown>;
    const pp = o.path ?? o.file_path ?? o.target_file ?? o.filePath ?? o.targetFile ?? o.uri;
    if (typeof pp === "string" && pp.trim()) {
      return pp.trim();
    }
  }
  return null;
}

/** 插件写入的 `metadata.resource.uri`（资源审计 / 记忆检索）。 */
export function resourceUriFromAuditMetadata(metadata: Record<string, unknown>): string | null {
  const r = metadata.resource;
  if (r && typeof r === "object" && !Array.isArray(r)) {
    const u = (r as Record<string, unknown>).uri;
    if (typeof u === "string" && u.trim()) {
      return u.trim();
    }
  }
  return null;
}

export function spanResourceUri(row: SemanticSpanRow): string | null {
  return resourceUriFromAuditMetadata(row.metadata) ?? ioPathFromInput(row.input);
}

export function estimatePayloadChars(v: unknown): number {
  if (typeof v === "string") {
    return v.length;
  }
  if (v == null) {
    return 0;
  }
  try {
    return JSON.stringify(v).length;
  } catch {
    return 0;
  }
}

export function toolResultChars(output: Record<string, unknown>): number {
  return Math.max(estimatePayloadChars(output.result), estimatePayloadChars(output.resultForLlm));
}

export function spanLargeFileWarning(row: SemanticSpanRow): boolean {
  const path = spanResourceUri(row);
  if (!path) {
    return false;
  }
  const outChars = toolResultChars(row.output);
  return outChars >= LARGE_IO_CHARS;
}

export function spanToolOversizedResult(row: SemanticSpanRow): boolean {
  if (row.type !== "TOOL" && row.type !== "SKILL" && row.type !== "IO" && row.type !== "MEMORY") {
    return false;
  }
  return toolResultChars(row.output) >= LARGE_TOOL_RESULT_CHARS;
}

export type MemoryHitPreview = { label: string; score?: number };

export function memoryHitsFromOutput(output: Record<string, unknown>): MemoryHitPreview[] {
  const out: MemoryHitPreview[] = [];
  const tk = output.top_k ?? output.topK ?? output.hits ?? output.results;
  if (Array.isArray(tk)) {
    for (let i = 0; i < Math.min(tk.length, 12); i++) {
      const item = tk[i];
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const o = item as Record<string, unknown>;
        const text =
          (typeof o.snippet === "string" && o.snippet) ||
          (typeof o.content === "string" && o.content) ||
          (typeof o.text === "string" && o.text) ||
          "";
        const score =
          typeof o.score === "number"
            ? o.score
            : typeof o.relevance === "number"
              ? o.relevance
              : typeof o.distance === "number"
                ? o.distance
                : undefined;
        const label = text.trim() ? (text.length > 120 ? `${text.slice(0, 119)}…` : text) : `#${i + 1}`;
        out.push({ label, score });
      }
    }
    return out;
  }
  const single = output.memoryHit ?? output.hit;
  if (single && typeof single === "object" && !Array.isArray(single)) {
    const o = single as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text : JSON.stringify(o);
    out.push({
      label: text.length > 120 ? `${text.slice(0, 119)}…` : text,
      score: typeof o.score === "number" ? o.score : undefined,
    });
  }
  return out;
}

export function memoryMetaFromMetadata(metadata: Record<string, unknown>): { path?: string; score?: number } {
  const ad = metadata.action_details;
  if (!ad || typeof ad !== "object" || Array.isArray(ad)) {
    return {};
  }
  const a = ad as Record<string, unknown>;
  const mc = a.memory_context;
  if (!mc || typeof mc !== "object" || Array.isArray(mc)) {
    return {};
  }
  const m = mc as Record<string, unknown>;
  return {
    path: typeof m.collection === "string" ? m.collection : undefined,
    score: typeof m.score === "number" ? m.score : undefined,
  };
}

/** Short “thought” line for LLM spans (output assistant texts or input prompt tail). */
export function llmThoughtPreview(row: SemanticSpanRow, max = 140): string {
  const texts = row.output.assistantTexts;
  if (Array.isArray(texts)) {
    const joined = texts.filter((x) => typeof x === "string").join(" ");
    if (joined.trim()) {
      const t = joined.trim();
      return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
    }
  }
  const prompt = row.input.prompt;
  if (typeof prompt === "string" && prompt.trim()) {
    const t = prompt.trim();
    return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
  }
  return row.name || "—";
}
