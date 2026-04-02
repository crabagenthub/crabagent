import type { SemanticSpanRow } from "@/lib/semantic-spans";

export type SkillUsedEntry = { label: string; skill_id?: string };

/**
 * 聚合本条 trace（消息）执行过程中使用的 skills：来自语义 span 中 type === SKILL
 *（由 collector 根据 span metadata.semantic_kind === "skill" 映射）。
 */
export function collectSkillsUsedFromSemanticSpans(items: SemanticSpanRow[]): SkillUsedEntry[] {
  const byKey = new Map<string, SkillUsedEntry>();
  for (const s of items) {
    if (s.type !== "SKILL") {
      continue;
    }
    const meta = s.metadata;
    const id = typeof meta.skill_id === "string" ? meta.skill_id.trim() : "";
    const nm = typeof meta.skill_name === "string" ? meta.skill_name.trim() : "";
    const label = (nm || id || s.name.trim()).trim();
    if (!label) {
      continue;
    }
    const key = (id || label).toLowerCase();
    if (byKey.has(key)) {
      continue;
    }
    byKey.set(key, id ? { label: nm || id, skill_id: id } : { label });
  }
  return [...byKey.values()];
}
