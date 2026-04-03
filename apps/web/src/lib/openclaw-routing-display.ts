/**
 * OpenClaw 路由列展示：与 Traces.* 文案键对齐，未知取值回退原文。
 */
const EM_DASH = "\u2014";

export type TracesTranslate = (key: string) => string;

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "");
}

/** Session / channel id 等会出现在 kind 字段；不是 Traces.openclawRouteKind_* 文案键。 */
function looksLikeUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}

function translateOrFallback(t: TracesTranslate, messageKey: string, fallback: string): string {
  try {
    const out = t(messageKey);
    return out === messageKey ? fallback : out;
  } catch {
    return fallback;
  }
}

function hintIfAny(t: TracesTranslate, messageKey: string): string | undefined {
  try {
    const out = t(messageKey);
    return out === messageKey ? undefined : out;
  } catch {
    return undefined;
  }
}

/** 类型（KIND）：direct / group 等 */
export function displayOpenclawKind(
  raw: string | undefined,
  t: TracesTranslate,
): { text: string; title?: string } {
  if (raw === undefined || raw.trim() === "") {
    return { text: EM_DASH };
  }
  const trimmed = raw.trim();
  if (looksLikeUuid(trimmed)) {
    return { text: trimmed };
  }
  const slug = slugify(raw) || trimmed.toLowerCase();
  if (looksLikeUuid(slug)) {
    return { text: trimmed };
  }
  const base = `openclawRouteKind_${slug}`;
  const text = translateOrFallback(t, base, trimmed);
  const title = hintIfAny(t, `${base}Hint`);
  return { text, title };
}

/** 思考强度 */
export function displayOpenclawThinking(
  raw: string | undefined,
  t: TracesTranslate,
): { text: string; title?: string } {
  if (raw === undefined || raw.trim() === "") {
    return { text: EM_DASH };
  }
  const slug = slugify(String(raw)) || String(raw).trim().toLowerCase();
  const base = `openclawRouteThinking_${slug}`;
  const text = translateOrFallback(t, base, String(raw).trim());
  const title = hintIfAny(t, `${base}Hint`);
  return { text, title };
}

function fastSlug(raw: string): string {
  const s = String(raw).trim().toLowerCase();
  if (s === "true" || s === "1" || s === "on" || s === "yes") {
    return "on";
  }
  if (s === "false" || s === "0" || s === "off" || s === "no") {
    return "off";
  }
  return slugify(raw) || s;
}

/** 快速模式 */
export function displayOpenclawFast(
  raw: string | undefined,
  t: TracesTranslate,
): { text: string; title?: string } {
  if (raw === undefined || raw === "") {
    return { text: EM_DASH };
  }
  const slug = fastSlug(String(raw));
  const base = `openclawRouteFast_${slug}`;
  const text = translateOrFallback(t, base, String(raw).trim());
  const title = hintIfAny(t, `${base}Hint`);
  return { text, title };
}

/** 输出详细程度 */
export function displayOpenclawVerbose(
  raw: string | undefined,
  t: TracesTranslate,
): { text: string; title?: string } {
  if (raw === undefined || raw.trim() === "") {
    return { text: EM_DASH };
  }
  const slug = slugify(String(raw)) || String(raw).trim().toLowerCase();
  const base = `openclawRouteVerbose_${slug}`;
  const text = translateOrFallback(t, base, String(raw).trim());
  const title = hintIfAny(t, `${base}Hint`);
  return { text, title };
}

/** 推理展示 / reasoning effort 等 */
export function displayOpenclawReasoning(
  raw: string | undefined,
  t: TracesTranslate,
): { text: string; title?: string } {
  if (raw === undefined || raw.trim() === "") {
    return { text: EM_DASH };
  }
  const slug = slugify(String(raw)) || String(raw).trim().toLowerCase();
  const base = `openclawRouteReasoning_${slug}`;
  const text = translateOrFallback(t, base, String(raw).trim());
  const title = hintIfAny(t, `${base}Hint`);
  return { text, title };
}
