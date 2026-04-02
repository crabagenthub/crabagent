/** 资源访问审计：在 tool span 上写入结构化 metadata.resource / semantic_kind，供 Collector 聚合。 */

const SNIPPET_MAX = 200;

function isPlainObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function strOf(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) {
    return v.trim();
  }
  return undefined;
}

function estimateChars(v: unknown): number {
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

function snippetFromResult(result: unknown): string | undefined {
  if (typeof result === "string") {
    const t = result.trim();
    return t.length <= SNIPPET_MAX ? t : `${t.slice(0, SNIPPET_MAX - 1)}…`;
  }
  if (isPlainObj(result)) {
    const text =
      strOf(result.content) ??
      strOf(result.text) ??
      strOf(result.body) ??
      (() => {
        try {
          return JSON.stringify(result);
        } catch {
          return "";
        }
      })();
    const t = text.trim();
    if (!t) {
      return undefined;
    }
    return t.length <= SNIPPET_MAX ? t : `${t.slice(0, SNIPPET_MAX - 1)}…`;
  }
  return undefined;
}

function firstPathFromParams(params: Record<string, unknown>): string | undefined {
  return (
    strOf(params.path) ??
    strOf(params.file_path) ??
    strOf(params.filePath) ??
    strOf(params.target_file) ??
    strOf(params.targetFile) ??
    strOf(params.uri) ??
    strOf(params.file)
  );
}

function toolNameLooksMemory(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.includes("memory") ||
    n.includes("recall") ||
    n.includes("rag") ||
    (n.includes("search") && (n.includes("kb") || n.includes("knowledge") || n.includes("vector")))
  );
}

function toolNameLooksFileRead(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n === "read_file" ||
    n.includes("read_file") ||
    (n.includes("read") && n.includes("file")) ||
    n === "file_read" ||
    n.includes("load_file")
  );
}

function toolNameLooksFileWrite(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n === "write_file" ||
    n.includes("write_file") ||
    (n.includes("write") && n.includes("file")) ||
    n === "edit_file" ||
    n.includes("apply_patch")
  );
}

function toolNameLooksGlob(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes("glob") || n.includes("list_dir") || n.includes("listdir");
}

/** OpenClaw / 常见 agent 将 skill 执行建模为 tool 调用；名称或参数需至少一端可识别。 */
function toolNameLooksSkill(name: string): boolean {
  const n = name.toLowerCase().replace(/-/g, "_").trim();
  if (!n) {
    return false;
  }
  if (n === "skill" || n === "skills") {
    return true;
  }
  if (n.startsWith("skills.") || n.startsWith("skill.")) {
    return true;
  }
  if (n.includes("run_skill") || n.includes("invoke_skill") || n.includes("skills_run") || n.includes("skill_run")) {
    return true;
  }
  if (n.endsWith(".skill") || n.endsWith("_skill")) {
    return true;
  }
  return false;
}

function skillIdOrNameFromParams(params: Record<string, unknown>): { id?: string; name?: string } {
  const nestedSkill = isPlainObj(params.skill) ? (params.skill as Record<string, unknown>) : null;
  const id =
    strOf(params.skill_id) ??
    strOf(params.skillId) ??
    strOf(params.skill_key) ??
    strOf(params.skillKey) ??
    (nestedSkill ? strOf(nestedSkill.id) ?? strOf(nestedSkill.key) : undefined);
  const name =
    strOf(params.skill_name) ??
    strOf(params.skillName) ??
    strOf(params.display_name) ??
    strOf(params.displayName) ??
    (nestedSkill ? strOf(nestedSkill.name) ?? strOf(nestedSkill.title) : undefined);
  const asStringSkill = typeof params.skill === "string" ? strOf(params.skill) : undefined;
  return {
    id: id ?? asStringSkill,
    name: name ?? (asStringSkill && !id ? asStringSkill : undefined),
  };
}

function detectSkillInvocation(
  toolName: string,
  params: Record<string, unknown>,
): { skill_id?: string; skill_name: string } | null {
  const byName = toolNameLooksSkill(toolName);
  const { id, name } = skillIdOrNameFromParams(params);
  if (!byName && !id && !name) {
    return null;
  }
  const skill_name = (name ?? id ?? toolName).trim();
  if (!skill_name) {
    return null;
  }
  return {
    skill_id: id ?? undefined,
    skill_name,
  };
}

/** 从 tool 结果中抽取 memory / RAG hits，写入 output.top_k 以兼容 span-insights。 */
function extractMemoryHits(result: unknown): Record<string, unknown>[] | undefined {
  if (Array.isArray(result)) {
    return result
      .filter((x) => isPlainObj(x))
      .map((x) => x as Record<string, unknown>)
      .slice(0, 24);
  }
  if (!isPlainObj(result)) {
    return undefined;
  }
  const tk = result.top_k ?? result.topK ?? result.hits ?? result.results ?? result.matches;
  if (Array.isArray(tk)) {
    return tk.filter(isPlainObj).map((x) => x as Record<string, unknown>).slice(0, 24);
  }
  return undefined;
}

function memoryQueryFromParams(params: Record<string, unknown>): string | undefined {
  return (
    strOf(params.query) ??
    strOf(params.q) ??
    strOf(params.prompt) ??
    strOf(params.search) ??
    strOf(params.text)
  );
}

/**
 * 在 `after_tool_call` 完成后就地增强 span：metadata.resource、metadata.semantic_kind、可选 output.top_k。
 */
export function enrichToolSpanResourceAudit(span: Record<string, unknown>): void {
  if (String(span.type ?? "") !== "tool") {
    return;
  }
  const toolName = String(span.name ?? "tool");
  const inputRaw = span.input;
  const input = isPlainObj(inputRaw) ? inputRaw : {};
  const paramsRaw = input.params;
  const params = isPlainObj(paramsRaw) ? paramsRaw : {};
  const outputRaw = span.output;
  const output: Record<string, unknown> = isPlainObj(outputRaw) ? { ...outputRaw } : {};
  const result = output.result;

  const prevMeta = isPlainObj(span.metadata) ? { ...span.metadata } : {};
  const chars = estimateChars(result);

  if (toolNameLooksMemory(toolName)) {
    const q = memoryQueryFromParams(params);
    const memUri = q ? `memory://search?q=${encodeURIComponent(q.slice(0, 500))}` : "memory://search";
    const hits = extractMemoryHits(result);
    if (hits && hits.length > 0) {
      output.top_k = hits.map((h) => {
        const text =
          strOf(h.snippet) ??
          strOf(h.content) ??
          strOf(h.text) ??
          (() => {
            try {
              return JSON.stringify(h);
            } catch {
              return "";
            }
          })();
        const score =
          typeof h.score === "number"
            ? h.score
            : typeof h.relevance === "number"
              ? h.relevance
              : typeof h.distance === "number"
                ? h.distance
                : undefined;
        return { snippet: text?.slice(0, 500), score, ...h };
      });
      span.output = output;
    }
    prevMeta.semantic_kind = "memory";
    prevMeta.resource = {
      uri: memUri,
      access_mode: "read",
      chars,
      query: q,
    };
    span.metadata = prevMeta;
    return;
  }

  if (toolNameLooksFileRead(toolName)) {
    const path = firstPathFromParams(params);
    if (path) {
      prevMeta.semantic_kind = "file";
      prevMeta.resource = {
        uri: path,
        access_mode: "read",
        chars,
        snippet: snippetFromResult(result),
      };
      span.metadata = prevMeta;
    }
    return;
  }

  if (toolNameLooksFileWrite(toolName)) {
    const path = firstPathFromParams(params);
    if (path) {
      prevMeta.semantic_kind = "file";
      prevMeta.resource = {
        uri: path.startsWith("file://") ? path : path,
        access_mode: "write",
        chars,
      };
      span.metadata = prevMeta;
    }
    return;
  }

  if (toolNameLooksGlob(toolName)) {
    const pattern = strOf(params.glob_pattern) ?? strOf(params.pattern) ?? strOf(params.path) ?? "*";
    prevMeta.semantic_kind = "file";
    prevMeta.resource = {
      uri: `file://glob/${encodeURIComponent(pattern.slice(0, 400))}`,
      access_mode: "read",
      chars,
    };
    span.metadata = prevMeta;
    return;
  }

  const skillInv = detectSkillInvocation(toolName, params);
  if (skillInv) {
    prevMeta.semantic_kind = "skill";
    if (skillInv.skill_id) {
      prevMeta.skill_id = skillInv.skill_id;
    }
    prevMeta.skill_name = skillInv.skill_name;
    span.metadata = prevMeta;
  }
}
