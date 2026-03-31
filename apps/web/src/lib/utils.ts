import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 统一 ID 简短显示模式：前缀:前8位…后10位 或 前12位…后10位。
 * 示例：agent:email_au…db933f7e7a
 */
export function formatShortId(id: string | null | undefined): string {
  if (!id) return "";
  const s = id.trim();
  if (s.length <= 24) return s;

  const colonIndex = s.indexOf(":");
  // 如果有前缀（如 agent:），保留前缀并缩短后续部分
  if (colonIndex > 0 && colonIndex < 16) {
    const prefix = s.slice(0, colonIndex + 1);
    const rest = s.slice(colonIndex + 1);
    if (rest.length > 18) {
      return `${prefix}${rest.slice(0, 8)}…${rest.slice(-10)}`;
    }
  }

  // 无前缀或前缀过长，直接缩短
  return `${s.slice(0, 12)}…${s.slice(-10)}`;
}
