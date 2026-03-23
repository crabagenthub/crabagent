/**
 * Parse `payload.crabagent` emitted by @crabagent/openclaw-trace-plugin.
 */

export type CrabagentLayerKey = "task" | "reasoning" | "memory" | "tools" | "state";

export type ParsedCrabagentPayload = {
  schema?: number;
  task?: Record<string, unknown>;
  reasoning?: Record<string, unknown>;
  memory?: Record<string, unknown>;
  tools?: Record<string, unknown>;
  state?: Record<string, unknown>;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v && typeof v === "object" && !Array.isArray(v));
}

export function parseCrabagentPayload(payload: unknown): ParsedCrabagentPayload | null {
  if (!isPlainObject(payload)) {
    return null;
  }
  const crab = payload.crabagent;
  if (!isPlainObject(crab)) {
    return null;
  }
  const layersRaw = crab.layers;
  if (!isPlainObject(layersRaw)) {
    return null;
  }
  const out: ParsedCrabagentPayload = {
    schema: typeof crab.schema === "number" && Number.isFinite(crab.schema) ? crab.schema : undefined,
  };
  const keys: CrabagentLayerKey[] = ["task", "reasoning", "memory", "tools", "state"];
  for (const k of keys) {
    const v = layersRaw[k];
    if (isPlainObject(v)) {
      out[k] = v;
    }
  }
  if (!out.task && !out.reasoning && !out.memory && !out.tools && !out.state) {
    return null;
  }
  return out;
}

export function crabagentPayloadHasLayers(payload: unknown): boolean {
  return parseCrabagentPayload(payload) !== null;
}
