import type Database from "better-sqlite3";

export type TraceMessagesListQuery = {
  limit: number;
  offset: number;
  order: "asc" | "desc";
  search?: string;
};

/**
 * opik 模型无独立 message_received 事件行；用 trace 的 input 摘要近似「用户消息列表」（可为空）。
 */
export function queryTraceMessages(_db: Database.Database, _q: TraceMessagesListQuery): Record<string, unknown>[] {
  return [];
}
