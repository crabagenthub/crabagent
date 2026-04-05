"use client";

import { useTranslations } from "next-intl";
import { IconExclamationCircle, IconSwap, IconClockCircle, IconCommon, IconTag } from "@arco-design/web-react/icon";
import { formatTraceDateTimeLocal } from "@/lib/trace-datetime";
import { formatDurationMsSemantic } from "@/lib/trace-records";
import type { SpanTreeNode } from "@/lib/build-span-tree";
import {
  spanResourceUri,
  llmThoughtPreview,
  memoryHitsFromOutput,
  memoryMetaFromMetadata,
  spanLargeFileWarning,
  spanToolOversizedResult,
} from "@/lib/span-insights";
import { TraceCopyIconButton } from "@/components/trace-copy-icon-button";
import { TokenUsagePopover } from "@/components/token-usage-details-card";
import { LlmModelIcon, MemoryBranchesIcon, ToolWrenchIcon } from "@/icons";
import { semanticSpanTokenEntries } from "@/lib/span-token-display";
import { cn } from "@/lib/utils";

/** 左侧 inspect 卡片头像底色（LLM / TOOL / MEMORY 与调用图 `execution-trace-flow` 对齐；其余与 `typeBadgeClass` 接近）。 */
function inspectStepAvatarClass(spanType: string): string {
  switch (spanType) {
    case "AGENT_LOOP":
      return "bg-violet-100 text-violet-950 ring-violet-300/40";
    case "LLM":
      return "bg-sky-100 text-sky-900 ring-sky-400/35";
    case "TOOL":
      /* 与 `execution-trace-flow` 调用图 spanKindBorder(TOOL) 一致（emerald） */
      return "bg-emerald-100 text-emerald-900 ring-emerald-400/35";
    case "IO":
      return "bg-cyan-100 text-cyan-900 ring-cyan-400/35";
    case "MEMORY":
      /* 与 `execution-trace-flow` 调用图 spanKindBorder(MEMORY) 一致（amber） */
      return "bg-amber-100 text-amber-900 ring-amber-400/35";
    case "PLUGIN":
      return "bg-orange-100 text-orange-900 ring-orange-400/35";
    case "SKILL":
      return "bg-lime-100 text-lime-900 ring-lime-400/35";
    default:
      return "bg-neutral-100 text-neutral-800 ring-neutral-300/45";
  }
}

function typeBadgeClass(spanType: string): string {
  switch (spanType) {
    case "AGENT_LOOP":
      return "bg-violet-100 text-violet-950 ring-violet-300/50";
    case "LLM":
      return "bg-sky-100 text-sky-950 ring-sky-400/40";
    case "TOOL":
      return "bg-amber-100 text-amber-950 ring-amber-400/40";
    case "IO":
      return "bg-cyan-100 text-cyan-950 ring-cyan-400/35";
    case "MEMORY":
      return "bg-fuchsia-100 text-fuchsia-950 ring-fuchsia-400/35";
    case "PLUGIN":
      return "bg-orange-100 text-orange-950 ring-orange-400/35";
    case "SKILL":
      return "bg-lime-100 text-lime-950 ring-lime-400/35";
    default:
      return "bg-neutral-100 text-neutral-800 ring-neutral-300/50";
  }
}

function durationMs(row: SpanTreeNode): number | null {
  const a = row.start_time;
  const b = row.end_time;
  if (typeof a !== "number" || typeof b !== "number" || !Number.isFinite(a) || !Number.isFinite(b)) {
    return null;
  }
  const d = b - a;
  return d >= 0 ? d : null;
}

function spanTagCount(node: SpanTreeNode): number {
  const raw = node.metadata?.tags;
  if (!Array.isArray(raw)) {
    return 0;
  }
  return raw.filter((x) => typeof x === "string" && x.trim().length > 0).length;
}

function hasTokenMetrics(node: SpanTreeNode): boolean {
  const bd = node.usage_breakdown && typeof node.usage_breakdown === "object" ? node.usage_breakdown : {};
  return (
    node.total_tokens != null ||
    (node.prompt_tokens != null && node.prompt_tokens > 0) ||
    (node.completion_tokens != null && node.completion_tokens > 0) ||
    (node.cache_read_tokens != null && node.cache_read_tokens > 0) ||
    Object.keys(bd).length > 0
  );
}

function timelineBarPct(
  node: SpanTreeNode,
  range: { start: number; end: number },
): { leftPct: number; widthPct: number } | null {
  const t0 = range.start;
  const t1 = range.end;
  if (!(t1 > t0)) {
    return null;
  }
  const a = node.start_time;
  const b = node.end_time ?? node.start_time;
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return null;
  }
  const span = t1 - t0;
  const leftPct = ((a - t0) / span) * 100;
  const widthPct = Math.max(0.4, ((b - a) / span) * 100);
  return {
    leftPct: Math.max(0, Math.min(100 - widthPct, leftPct)),
    widthPct: Math.min(100, widthPct),
  };
}

function TreeNodeRow({
  node,
  depth,
  selectedId,
  onSelect,
  parentType,
  variant,
  traceTimeRange,
}: {
  node: SpanTreeNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  parentType: string | null;
  variant: "default" | "inspect";
  traceTimeRange: { start: number; end: number } | null;
}) {
  const t = useTranslations("Traces");
  const active = selectedId === node.span_id;
  const decisionBranch =
    parentType === "LLM" &&
    (node.type === "TOOL" ||
      node.type === "SKILL" ||
      node.type === "IO" ||
      node.type === "MEMORY" ||
      node.type === "PLUGIN");
  const when = formatTraceDateTimeLocal(new Date(node.start_time).toISOString());
  const dur = durationMs(node);
  const path = spanResourceUri(node);
  const largeFile = spanLargeFileWarning(node);
  const fatTool = spanToolOversizedResult(node);
  const memMeta = memoryMetaFromMetadata(node.metadata);
  const hits = memoryHitsFromOutput(node.output);
  const bar = variant === "inspect" && traceTimeRange ? timelineBarPct(node, traceTimeRange) : null;

  let subtitle: string | null = null;
  if (node.type === "AGENT_LOOP" && node.loopRound != null) {
    subtitle = t("semanticLoopRound", { n: String(node.loopRound) });
  } else if (node.type === "LLM") {
    subtitle = llmThoughtPreview(node, 160);
  } else if (path) {
    subtitle = path;
  } else if (node.name) {
    subtitle = node.name;
  }

  const titleLine =
    node.module && node.module.trim()
      ? `${node.name} · ${node.module.trim()}`
      : node.name;
  const pt = node.prompt_tokens;
  const ct = node.completion_tokens;
  const cacheRead = node.cache_read_tokens;
  const totalTok =
    node.total_tokens ??
    (typeof pt === "number" && typeof ct === "number"
      ? pt + ct + (typeof cacheRead === "number" ? cacheRead : 0)
      : null);
  const tagsN = spanTagCount(node);
  const showTokens = hasTokenMetrics(node);

  if (variant === "inspect") {
    return (
      <div className="select-none">
        <div className="flex items-start gap-0.5" style={{ marginLeft: depth * 12 }}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => onSelect(node.span_id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(node.span_id);
            }
          }}
          title={decisionBranch ? t("semanticDecisionNodeTitle") : undefined}
          className={cn(
            "relative min-w-0 flex-1 flex flex-col gap-1.5 rounded-lg border px-2.5 py-2 text-left text-sm transition outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            active
              ? "border-sky-300 bg-sky-50 shadow-sm ring-2 ring-sky-200/80"
              : decisionBranch
                ? "border-amber-200/90 bg-amber-50/50 hover:border-amber-300 hover:bg-amber-50/80"
                : "border-neutral-200/90 bg-white hover:border-neutral-300 hover:bg-neutral-50/80",
          )}
        >
          {largeFile || fatTool ? (
            <span className="absolute right-2.5 top-2 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-900">
              {largeFile ? t("semanticLargeFileBadge") : t("semanticLargeResultBadge")}
            </span>
          ) : null}
          <div className="flex items-start gap-2">
            <span
              className={cn(
                "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md ring-1 ring-inset",
                inspectStepAvatarClass(node.type),
              )}
              aria-hidden
            >
              {node.type === "MEMORY" ? (
                <MemoryBranchesIcon className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              ) : node.type === "LLM" ? (
                <LlmModelIcon className="size-4 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden />
              ) : node.type === "TOOL" ? (
                <ToolWrenchIcon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              ) : (
                <span className="text-[10px] font-bold">{node.type.slice(0, 1)}</span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <span className="line-clamp-2 break-all text-xs font-medium leading-snug text-neutral-900">
                  {titleLine}
                </span>
                {node.error ? (
                  <IconExclamationCircle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-label={t("semanticErrorBadge")} />
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] tabular-nums text-neutral-600">
                <span className="inline-flex items-center gap-0.5" title={t("semanticTreeDurHint")}>
                   <IconClockCircle className="size-3 shrink-0 text-neutral-400" aria-hidden />
                   {formatDurationMsSemantic(dur)}
                 </span>
                {showTokens && totalTok != null ? (
                  <TokenUsagePopover
                    position="rt"
                    trigger="hover"
                    entries={semanticSpanTokenEntries(node)}
                  >
                    <span
                      className="inline-flex max-w-full cursor-default items-center gap-0.5 rounded-sm text-left text-neutral-600 hover:text-neutral-900"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <IconCommon className="size-3 shrink-0 text-neutral-400" aria-hidden />
                      <span>{totalTok.toLocaleString()}</span>
                      {typeof pt === "number" && typeof ct === "number" ? (
                        <>
                          <IconSwap className="size-3 shrink-0 text-neutral-400" aria-hidden />
                          <span>
                            {pt.toLocaleString()}/{ct.toLocaleString()}
                          </span>
                        </>
                      ) : null}
                    </span>
                  </TokenUsagePopover>
                ) : null}
                {tagsN > 0 ? (
                  <span
                    className="inline-flex items-center gap-0.5 text-neutral-500"
                    title={t("semanticTreeTagCountHint", { n: String(tagsN) })}
                  >
                    <IconTag className="size-3 shrink-0 text-neutral-400" aria-hidden />
                    {tagsN}
                  </span>
                ) : null}
              </div>
              {bar ? (
                <div className="relative mt-1.5 h-1.5 w-full rounded-full bg-neutral-100">
                  <div
                    className="absolute top-0 h-full min-w-[2px] rounded-full bg-violet-500/90"
                    style={{ left: `${bar.leftPct}%`, width: `${bar.widthPct}%` }}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
        </div>
        {node.children.length > 0 ? (
          <div className="mt-2 space-y-2 border-l border-neutral-200 pl-2">
            {node.children.map((ch) => (
              <TreeNodeRow
                key={ch.span_id}
                node={ch}
                depth={depth + 1}
                selectedId={selectedId}
                onSelect={onSelect}
                parentType={node.type}
                variant={variant}
                traceTimeRange={traceTimeRange}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="select-none">
      <div className="flex items-start gap-0.5" style={{ marginLeft: depth * 14 }}>
      <button
        type="button"
        onClick={() => onSelect(node.span_id)}
        title={decisionBranch ? t("semanticDecisionNodeTitle") : undefined}
        className={[
          "flex min-w-0 flex-1 flex-col gap-1 rounded-xl border px-3 py-2 text-left text-sm transition",
          active
            ? "border-primary bg-white shadow-md ring-2 ring-primary/35"
            : decisionBranch
              ? "border-amber-300/90 bg-amber-50/40 ring-2 ring-amber-400/55 hover:border-amber-400 hover:bg-amber-50/70"
              : "border-border/80 bg-white/90 hover:border-border hover:bg-white",
        ].join(" ")}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ${typeBadgeClass(node.type)}`}
          >
            {node.type === "MEMORY" ? (
              <MemoryBranchesIcon className="size-3.5 shrink-0 opacity-90" aria-hidden />
            ) : null}
            {node.type}
          </span>
          <span className="text-[10px] text-ca-muted">{when}</span>
          {dur != null ? (
            <span className="text-[10px] tabular-nums text-neutral-500">{dur}ms</span>
          ) : null}
          {node.error ? (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800">
              {t("semanticErrorBadge")}
            </span>
          ) : null}
          {largeFile ? (
            <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-950">
              {t("semanticLargeFileBadge")}
            </span>
          ) : null}
          {fatTool && !largeFile ? (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
              {t("semanticLargeResultBadge")}
            </span>
          ) : null}
        </div>
        <div className="line-clamp-2 break-all text-xs text-neutral-800">
          <span className="font-medium text-neutral-600">{node.name}</span>
          {subtitle ? <span className="text-neutral-800"> · {subtitle}</span> : null}
        </div>
        {memMeta.path != null || memMeta.score != null ? (
          <p className="text-[10px] text-fuchsia-900/90">
            {memMeta.path ? <span>{memMeta.path}</span> : null}
            {memMeta.score != null ? (
              <span className="ml-2 tabular-nums">score {memMeta.score.toFixed(4)}</span>
            ) : null}
          </p>
        ) : null}
        {hits.length > 0 ? (
          <p className="text-[10px] text-fuchsia-800/90">
            {t("semanticMemoryHitsInline", { count: String(hits.length) })}
          </p>
        ) : null}
      </button>
      {node.span_id.trim() ? (
        <TraceCopyIconButton
          text={node.span_id}
          ariaLabel={t("copySpanIdAria")}
          tooltipLabel={t("copy")}
          successLabel={t("copySuccessToast")}
          className="mt-1.5 shrink-0 p-0.5 hover:bg-neutral-200/80"
          stopPropagation
        />
      ) : null}
      </div>
      {node.children.length > 0 ? (
        <div className="mt-2 space-y-2 border-l border-border/60 pl-2">
          {node.children.map((ch) => (
            <TreeNodeRow
              key={ch.span_id}
              node={ch}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              parentType={node.type}
              variant={variant}
              traceTimeRange={traceTimeRange}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function TraceSemanticTree({
  forest,
  selectedId,
  onSelect,
  variant = "default",
  traceTimeRange = null,
}: {
  forest: SpanTreeNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** `inspect`: compact rows, seconds duration, timeline bar (needs `traceTimeRange`). */
  variant?: "default" | "inspect";
  traceTimeRange?: { start: number; end: number } | null;
}) {
  const t = useTranslations("Traces");
  if (forest.length === 0) {
    return (
      <p className="px-3 py-6 text-sm text-ca-muted">{t("semanticTreeEmpty")}</p>
    );
  }
  const treeBody = (
    <>
      {variant === "default" ? (
        <p className="text-xs leading-relaxed text-ca-muted">{t("semanticTreeHint")}</p>
      ) : null}
      <div className={cn("space-y-2", variant === "inspect" && "space-y-2.5")}>
        {forest.map((n) => (
          <TreeNodeRow
            key={n.span_id}
            node={n}
            depth={0}
            selectedId={selectedId}
            onSelect={onSelect}
            parentType={null}
            variant={variant}
            traceTimeRange={traceTimeRange}
          />
        ))}
      </div>
    </>
  );

  return (
    <div
      className={cn(
        "space-y-3",
        variant === "default" ? "p-3 sm:p-4" : "py-2 pl-2 pr-4 sm:py-2 sm:pl-3 sm:pr-5",
      )}
    >
      {treeBody}
    </div>
  );
}
