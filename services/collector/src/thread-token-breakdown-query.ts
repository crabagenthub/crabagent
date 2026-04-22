import type Database from "better-sqlite3";
import { parseUsageExtended } from "./semantic-spans-query.js";

export type ThreadTokenBreakdown = {
  thread_key: string;
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_tokens: number;
  /** Sum of per-span `parseUsageExtended.total_tokens` for LLM spans（可与 thread 列表 trace 级汇总不同）。 */
  total_tokens: number;
};

/**
 * 聚合某会话 thread key 下所有 `llm` span 的 `usage_json`（应用层 parse，与语义 API 一致）。
 * 用于详情/统计；非列表热路径。
 */
export function queryThreadTokenBreakdown(db: Database.Database, threadKey: string): ThreadTokenBreakdown {
  const key = threadKey.trim();
  if (!key) {
    return {
      thread_key: "",
      prompt_tokens: 0,
      completion_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 0,
    };
  }

  const rows = db
    .prepare(
      `SELECT s.usage_json
       FROM opik_spans s
       INNER JOIN opik_traces t ON t.trace_id = s.trace_id
       WHERE COALESCE(NULLIF(TRIM(t.thread_id), ''), t.trace_id) = ?
         AND lower(s.span_type) = 'llm'`,
    )
    .all(key) as { usage_json: string | null }[];

  let prompt = 0;
  let completion = 0;
  let cacheRead = 0;
  let total = 0;

  for (const r of rows) {
    const u = parseUsageExtended(r.usage_json);
    if (u.prompt_tokens != null && Number.isFinite(u.prompt_tokens)) {
      prompt += Math.max(0, Math.trunc(u.prompt_tokens));
    }
    if (u.completion_tokens != null && Number.isFinite(u.completion_tokens)) {
      completion += Math.max(0, Math.trunc(u.completion_tokens));
    }
    if (u.cache_read_tokens != null && Number.isFinite(u.cache_read_tokens)) {
      cacheRead += Math.max(0, Math.trunc(u.cache_read_tokens));
    }
    if (u.total_tokens != null && Number.isFinite(u.total_tokens)) {
      total += Math.max(0, Math.trunc(u.total_tokens));
    }
  }

  if (total === 0 && (prompt > 0 || completion > 0 || cacheRead > 0)) {
    total = prompt + completion + cacheRead;
  }

  return {
    thread_key: key,
    prompt_tokens: prompt,
    completion_tokens: completion,
    cache_read_tokens: cacheRead,
    total_tokens: total,
  };
}
