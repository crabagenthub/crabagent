/**
 * 从 OpenClaw `thread_key` / sessionKey 形态推断入站渠道（如 `agent:<id>:feishu:…`）。
 */
export type PipelineInboundChannel =
  | "feishu"
  | "telegram"
  | "discord"
  | "slack"
  | "webchat"
  | "whatsapp"
  | "email"
  | "github"
  | "signal"
  | "line"
  | "teams"
  | "generic";

export function inferInboundChannelFromThreadKey(threadKey: string): PipelineInboundChannel {
  const s = threadKey.trim().toLowerCase();
  if (!s) {
    return "generic";
  }
  const parts = s.split(":");
  const seg = (i: number) => parts[i]?.toLowerCase() ?? "";

  /** `agent:<agentId>:<provider>:…` 第三段常为渠道 */
  const third = seg(2);
  const fourth = seg(3);

  const hit = (p: RegExp | string): boolean => {
    if (typeof p === "string") {
      return s.includes(p) || third === p || fourth === p;
    }
    return p.test(s);
  };

  if (hit("feishu") || hit("lark") || hit(/飞书/)) {
    return "feishu";
  }
  if (hit("telegram")) {
    return "telegram";
  }
  if (hit("discord")) {
    return "discord";
  }
  if (hit("slack")) {
    return "slack";
  }
  if (hit("webchat") || hit("web_chat")) {
    return "webchat";
  }
  if (hit("whatsapp") || hit("wa_")) {
    return "whatsapp";
  }
  if (hit("github")) {
    return "github";
  }
  if (hit("signal")) {
    return "signal";
  }
  if (third === "line" || fourth === "line") {
    return "line";
  }
  if (hit("teams") || hit("msteams")) {
    return "teams";
  }
  if (
    hit("email") ||
    hit("gmail") ||
    hit("inbox") ||
    hit(/:mail/) ||
    hit("smtp") ||
    hit("email_automatic")
  ) {
    return "email";
  }

  return "generic";
}
