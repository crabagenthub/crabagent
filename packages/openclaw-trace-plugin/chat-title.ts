/** Derives a short UI label from OpenClaw `message_received` metadata. */

function looksLikeProviderAddress(value: string): boolean {
  const t = value.trim();
  if (t.length === 0) {
    return true;
  }
  // e.g. telegram:chat:1, channel:C123, whatsapp:+1...
  return /^[a-z][a-z0-9_-]{0,24}:/i.test(t);
}

/**
 * Human-readable chat label for trace UIs (Feishu/Lark group title, WeChat room name,
 * Discord/Slack channel name, DM contact name, etc.).
 */
export function deriveChatTitleFromMessageMetadata(md: Record<string, unknown>): string | undefined {
  const conversationLabel =
    typeof md.conversationLabel === "string" ? md.conversationLabel.trim() : "";
  if (conversationLabel) {
    return conversationLabel;
  }
  const groupSubject = typeof md.groupSubject === "string" ? md.groupSubject.trim() : "";
  if (groupSubject) {
    return groupSubject;
  }
  const channelName = typeof md.channelName === "string" ? md.channelName.trim() : "";
  if (channelName) {
    return channelName;
  }
  const isGroup = md.isGroup === true;
  if (!isGroup) {
    const senderName = typeof md.senderName === "string" ? md.senderName.trim() : "";
    if (senderName) {
      return senderName;
    }
    const toRaw = typeof md.to === "string" ? md.to.trim() : "";
    if (toRaw && !looksLikeProviderAddress(toRaw)) {
      return toRaw;
    }
  }
  return undefined;
}
