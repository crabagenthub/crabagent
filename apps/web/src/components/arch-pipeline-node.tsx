"use client";

import { useTranslations } from "next-intl";
import { memo } from "react";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { GatewayIcon, InboundChannelIcon } from "@/components/arch-pipeline-channel-icons";
import type { PipelineInboundChannel } from "@/lib/arch-pipeline-channel";
import type { ArchPipelineNodeData, ArchPipelineStage } from "@/lib/execution-architecture-overview";
import { cn } from "@/lib/utils";

const stageBorder: Record<ArchPipelineStage, string> = {
  inbound: "border-sky-500/50 bg-sky-500/10",
  gateway: "border-violet-500/50 bg-violet-500/10",
  runner: "border-amber-500/50 bg-amber-500/10",
  llm: "border-cyan-400/70 bg-cyan-500/10",
  tools: "border-emerald-500/50 bg-emerald-500/10",
  response: "border-fuchsia-500/50 bg-fuchsia-500/10",
};

function archChannelNameKey(ch: PipelineInboundChannel) {
  switch (ch) {
    case "feishu":
      return "archChannelName_feishu" as const;
    case "telegram":
      return "archChannelName_telegram" as const;
    case "discord":
      return "archChannelName_discord" as const;
    case "slack":
      return "archChannelName_slack" as const;
    case "webchat":
      return "archChannelName_webchat" as const;
    case "whatsapp":
      return "archChannelName_whatsapp" as const;
    case "email":
      return "archChannelName_email" as const;
    case "github":
      return "archChannelName_github" as const;
    case "signal":
      return "archChannelName_signal" as const;
    case "line":
      return "archChannelName_line" as const;
    case "teams":
      return "archChannelName_teams" as const;
    case "generic":
    default:
      return "archChannelName_generic" as const;
  }
}

function stageTitle(stage: ArchPipelineStage, t: (key: string) => string): string {
  switch (stage) {
    case "inbound":
      return t("archPipelineStage_inbound");
    case "gateway":
      return t("archPipelineStage_gateway");
    case "runner":
      return t("archPipelineStage_runner");
    case "llm":
      return t("archPipelineStage_llm");
    case "tools":
      return t("archPipelineStage_tools");
    case "response":
      return t("archPipelineStage_response");
    default:
      return stage;
  }
}

const bridgeStages = new Set<ArchPipelineStage>(["runner", "llm", "tools"]);

export const ArchPipelineNode = memo(function ArchPipelineNodeFn(props: NodeProps) {
  const t = useTranslations("Traces");
  const d = props.data as ArchPipelineNodeData;
  const showBridge = d.showFrameworkBridge === true && bridgeStages.has(d.stage);

  const lines: string[] = [];
  if (d.stage === "runner") {
    lines.push(t("archPipelineRunnerBullets"));
  }
  if (d.stage === "llm") {
    if (d.modelLabel) {
      lines.push(`${d.providerLabel ? `${d.providerLabel} · ` : ""}${d.modelLabel}`);
    }
    if (d.llmRoundCount > 1) {
      lines.push(t("archPipelineLlmRounds", { n: String(d.llmRoundCount) }));
    }
  }
  if (d.stage === "tools") {
    if (d.toolMode === "parallel" || d.toolMode === "sequential") {
      lines.push(
        `${t("execNodeiseeagentcch")}: ${d.toolMode === "parallel" ? t("execiseeagentcchParallel") : t("execiseeagentcchSequential")}`,
      );
    }
    if (d.toolNames.length > 0) {
      lines.push(d.toolNames.slice(0, 6).join(" · "));
      if (d.toolNames.length > 6) {
        lines.push(`+${d.toolNames.length - 6}`);
      }
    } else {
      lines.push(t("archPipelineToolsEmpty"));
    }
    if (d.hasToolLoopBack) {
      lines.push(t("archPipelineLoopHint"));
    }
  }

  return (
    <div
      className={cn(
        "relative w-[208px] rounded-md border-2 px-2 py-1.5 text-left text-[10px] shadow-sm",
        "bg-card text-card-foreground",
        stageBorder[d.stage],
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !min-h-0 !min-w-0 !border-0 !bg-slate-400"
      />
      <div className="mb-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">{t("archPipelineLane")}</div>
      <div className="mt-0.5 flex items-start gap-2">
        {d.stage === "inbound" ? <InboundChannelIcon channel={d.inboundChannel ?? "generic"} /> : null}
        {d.stage === "gateway" ? <GatewayIcon /> : null}
        <div className="min-w-0 flex-1">
          <div className="text-[11px] leading-snug">
            <span className="font-semibold text-foreground">{stageTitle(d.stage, t)}</span>
          </div>
          {d.stage === "inbound" ? (
            <div className="mt-0.5 text-[9px] leading-snug text-muted-foreground">
              {t(archChannelNameKey(d.inboundChannel ?? "generic"))}
            </div>
          ) : null}
          {d.stage === "gateway" ? (
            <div className="mt-0.5 text-[9px] leading-snug text-muted-foreground">{t("archPipelineGatewaySubtitle")}</div>
          ) : null}
        </div>
      </div>
      {lines.length > 0 ? (
        <div className="mt-1 space-y-0.5 text-[9px] leading-snug text-muted-foreground">
          {lines.map((line, i) => (
            <div key={`${d.stage}-${i}`} className="line-clamp-3">
              {line}
            </div>
          ))}
        </div>
      ) : null}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !min-h-0 !min-w-0 !border-0 !bg-slate-400"
      />
      {showBridge ? (
        <Handle
          id="bridge"
          type="source"
          position={Position.Bottom}
          className="!h-2 !w-2 !min-h-0 !min-w-0 !border-0 !bg-slate-400"
        />
      ) : null}
    </div>
  );
});
