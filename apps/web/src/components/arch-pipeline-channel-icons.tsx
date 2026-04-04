"use client";

import type { ReactNode } from "react";
import {
  Cloud,
  Github,
  Hash,
  Headphones,
  Mail,
  MessageCircle,
  Monitor,
  Network,
  Send,
  Smartphone,
} from "lucide-react";
import type { PipelineInboundChannel } from "@/lib/arch-pipeline-channel";
import { cn } from "@/lib/utils";

const iconBox = "flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background/80 shadow-sm";
const iconClass = "size-[22px]";

/** 飞书 / Lark：云形 + 品牌色点缀 */
function FeishuGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="currentColor"
        className="text-sky-600 dark:text-sky-400"
        d="M12 3 4 7v10l8 4 8-4V7l-8-4zm0 2.18 5.5 2.75v6.14L12 18.82l-5.5-2.75V7.93L12 5.18z"
      />
      <path fill="currentColor" className="text-sky-500/90" d="M9.2 10.2h1.4v3.6H9.2v-3.6zm4.2 0h1.4v3.6h-1.4v-3.6z" />
    </svg>
  );
}

/** Telegram 纸飞机（常见简化路径） */
function TelegramGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="currentColor"
        className="text-sky-500 dark:text-sky-400"
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"
      />
    </svg>
  );
}

function channelGlyph(ch: PipelineInboundChannel): ReactNode {
  switch (ch) {
    case "feishu":
      return <FeishuGlyph className={iconClass} />;
    case "telegram":
      return <TelegramGlyph className={iconClass} />;
    case "discord":
      return <Headphones className={cn(iconClass, "text-indigo-500 dark:text-indigo-400")} strokeWidth={2} />;
    case "slack":
      return <Hash className={cn(iconClass, "text-purple-600 dark:text-purple-400")} strokeWidth={2.25} />;
    case "webchat":
      return <Monitor className={cn(iconClass, "text-emerald-600 dark:text-emerald-400")} strokeWidth={2} />;
    case "whatsapp":
      return <MessageCircle className={cn(iconClass, "text-green-600 dark:text-green-400")} strokeWidth={2} />;
    case "email":
      return <Mail className={cn(iconClass, "text-amber-700 dark:text-amber-400")} strokeWidth={2} />;
    case "github":
      return <Github className={cn(iconClass, "text-neutral-700 dark:text-neutral-200")} strokeWidth={2} />;
    case "signal":
      return <Send className={cn(iconClass, "text-blue-600 dark:text-blue-400")} strokeWidth={2} />;
    case "line":
      return <MessageCircle className={cn(iconClass, "text-green-500")} strokeWidth={2} />;
    case "teams":
      return <Cloud className={cn(iconClass, "text-violet-600 dark:text-violet-400")} strokeWidth={2} />;
    case "generic":
    default:
      return <Smartphone className={cn(iconClass, "text-muted-foreground")} strokeWidth={2} />;
  }
}

export function InboundChannelIcon({ channel }: { channel: PipelineInboundChannel }) {
  return (
    <div className={iconBox} title={channel}>
      {channelGlyph(channel)}
    </div>
  );
}

/** 通用网关：网络/路由意象（Lucide Network） */
export function GatewayIcon() {
  return (
    <div className={iconBox}>
      <Network className={cn(iconClass, "text-violet-600 dark:text-violet-400")} strokeWidth={2} aria-hidden />
    </div>
  );
}
