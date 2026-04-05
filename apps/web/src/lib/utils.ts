import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 统一 ID 简短显示模式：尽量保留辨识度，同时缩短表格里的横向占用。
 * 列表「文本」列中比极短模式多保留若干字符，便于区分相近 id。
 * 示例：agent:emailaddr…33f7e7a9 / trace_abc123def…ef9021ab
 */
export function formatShortId(id: string | null | undefined): string {
  if (!id) return "";
  const s = id.trim();
  if (s.length <= 28) return s;

  const colonIndex = s.indexOf(":");
  // 如果有前缀（如 agent:），保留前缀并缩短后续部分
  if (colonIndex > 0 && colonIndex < 22) {
    const prefix = s.slice(0, colonIndex + 1);
    const rest = s.slice(colonIndex + 1);
    if (rest.length > 16) {
      return `${prefix}${rest.slice(0, 10)}…${rest.slice(-10)}`;
    }
  }

  // 无前缀或前缀过长，直接缩短
  return `${s.slice(0, 14)}…${s.slice(-8)}`;
}

/**
 * 会话列表专用：比 {@link formatShortId} 保留更多字符，仍避免单行过长。
 */
export function formatThreadListSessionId(id: string | null | undefined): string {
  if (!id) return "";
  const s = id.trim();
  if (s.length <= 36) return s;

  const colonIndex = s.indexOf(":");
  if (colonIndex > 0 && colonIndex < 28) {
    const prefix = s.slice(0, colonIndex + 1);
    const rest = s.slice(colonIndex + 1);
    if (rest.length > 22) {
      return `${prefix}${rest.slice(0, 12)}…${rest.slice(-10)}`;
    }
  }

  return `${s.slice(0, 16)}…${s.slice(-10)}`;
}
