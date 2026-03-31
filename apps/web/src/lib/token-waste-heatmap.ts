import type { TraceTimelineEvent } from "@/components/trace-timeline-tree";
import { parseCrabagentPayload } from "@/lib/trace-crabagent-layers";
import { usageFromTracePayload } from "@/lib/trace-payload-usage";
import { buildUserTurnList } from "@/lib/user-turn-list";

function rowNumericId(e: TraceTimelineEvent): number {
  const n = e.id;
  if (typeof n === "number" && Number.isFinite(n)) {
    return n;
  }
  return Number.MAX_SAFE_INTEGER;
}

function assistantCharsFromPayload(payload: Record<string, unknown>): number {
  const texts = payload.assistantTexts;
  if (Array.isArray(texts)) {
    let n = 0;
    for (const t of texts) {
      if (typeof t === "string") {
        n += t.length;
      }
    }
    return n;
  }
  const crab = parseCrabagentPayload(payload);
  const raw = crab?.reasoning?.rawOutputText;
  if (typeof raw === "string") {
    return raw.length;
  }
  return 0;
}

/** Raw "idle spin" score: high when prompt-heavy vs completion + visible reply text. */
function rawIdleHeat(prompt: number, completion: number, assistantChars: number): number {
  if (prompt <= 0 && completion <= 0 && assistantChars <= 0) {
    return 0;
  }
  const textEquiv = Math.min(assistantChars, 12_000) * 0.02;
  const denom = completion + textEquiv + 100;
  const ratio = (prompt + completion * 0.25) / Math.max(1, denom);
  return Math.min(1, Math.log(1 + ratio) / Math.log(1 + 42));
}

export type TokenWasteTurnCell = {
  hasData: boolean;
  /** 0–1 after optional batch normalization */
  heat: number;
  rawHeat: number;
  promptTokens: number;
  completionTokens: number;
  assistantChars: number;
  llmRoundCount: number;
  userPreview: string;
};

export type TokenWasteThreadRow = {
  threadKey: string;
  label: string;
  turns: TokenWasteTurnCell[];
};

function sortChrono(events: TraceTimelineEvent[]): TraceTimelineEvent[] {
  return [...events].sort((a, b) => rowNumericId(a) - rowNumericId(b));
}

/**
 * One row per user turn; aggregates all `llm_output` events strictly after that turn’s anchor
 * until the next user turn.
 */
export function buildTokenWasteRowForThread(params: {
  threadKey: string;
  label: string;
  events: TraceTimelineEvent[];
}): TokenWasteThreadRow {
  const sorted = sortChrono(params.events);
  const turns = buildUserTurnList(sorted);

  const cells: TokenWasteTurnCell[] = turns.map((turn, i) => {
    const start = turn.numericId;
    const end = i + 1 < turns.length ? turns[i + 1]!.numericId : Number.MAX_SAFE_INTEGER;
    const slice = sorted.filter((e) => {
      const id = rowNumericId(e);
      return id > start && id < end && e.type === "llm_output";
    });

    let promptTokens = 0;
    let completionTokens = 0;
    let assistantChars = 0;
    for (const e of slice) {
      const payload =
        e.payload && typeof e.payload === "object" && !Array.isArray(e.payload)
          ? (e.payload as Record<string, unknown>)
          : {};
      const u = usageFromTracePayload(payload);
      promptTokens += u.prompt;
      completionTokens += u.completion;
      assistantChars += assistantCharsFromPayload(payload);
    }

    const hasData = slice.length > 0;
    const rawHeat = hasData ? rawIdleHeat(promptTokens, completionTokens, assistantChars) : 0;

    return {
      hasData,
      heat: rawHeat,
      rawHeat,
      promptTokens,
      completionTokens,
      assistantChars,
      llmRoundCount: slice.length,
      userPreview: turn.preview,
    };
  });

  return {
    threadKey: params.threadKey,
    label: params.label,
    turns: cells,
  };
}

export function normalizeHeatAcrossThreads(rows: TokenWasteThreadRow[]): TokenWasteThreadRow[] {
  let maxRaw = 0;
  for (const r of rows) {
    for (const t of r.turns) {
      if (t.hasData) {
        maxRaw = Math.max(maxRaw, t.rawHeat);
      }
    }
  }
  const denom = maxRaw > 1e-9 ? maxRaw : 1;
  return rows.map((r) => ({
    ...r,
    turns: r.turns.map((t) => ({
      ...t,
      heat: t.hasData ? Math.min(1, t.rawHeat / denom) : 0,
    })),
  }));
}

export function maxTurnCount(rows: TokenWasteThreadRow[], cap: number): number {
  let m = 1;
  for (const r of rows) {
    m = Math.max(m, r.turns.length);
  }
  return Math.min(cap, m);
}
