"use client";

import { Popover } from "@arco-design/web-react";
import { useTranslations } from "next-intl";
import { IconExclamationCircle, IconSwap, IconClockCircle, IconCommon, IconTag } from "@arco-design/web-react/icon";
import { formatTraceDateTimeLocal } from "@/lib/trace-datetime";
import type { SpanTreeNode } from "@/lib/build-span-tree";
import {
  ioPathFromInput,
  llmThoughtPreview,
  memoryHitsFromOutput,
  memoryMetaFromMetadata,
  spanLargeFileWarning,
  spanToolOversizedResult,
} from "@/lib/span-insights";
import { cn } from "@/lib/utils";

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

function formatDurSeconds(durMs: number | null): string {
  if (durMs == null || !Number.isFinite(durMs) || durMs < 0) {
    return "—";
  }
  return `${(durMs / 1000).toFixed(1)}s`;
}

function spanTagCount(node: SpanTreeNode): number {
  const raw = node.metadata?.tags;
  if (!Array.isArray(raw)) {
    return 0;
  }
  return raw.filter((x) => typeof x === "string" && x.trim().length > 0).length;
}

function mergeTokenDisplay(node: SpanTreeNode): Record<string, number> {
  const bd =
    node.usage_breakdown && typeof node.usage_breakdown === "object"
      ? node.usage_breakdown
      : {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(bd)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = Math.trunc(v);
    }
  }
  const set = (k: string, v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v)) {
      return;
    }
    if (out[k] === undefined) {
      out[k] = Math.trunc(v);
    }
  };
  set("prompt_tokens", node.prompt_tokens);
  set("completion_tokens", node.completion_tokens);
  set("cache_read_tokens", node.cache_read_tokens);
  set("total_tokens", node.total_tokens);
  return out;
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

function InspectTokenUsagePopover({ node }: { node: SpanTreeNode }) {
  const t = useTranslations("Traces");
  const obj = mergeTokenDisplay(node);
  const canon = ["prompt_tokens", "completion_tokens", "cache_read_tokens", "total_tokens"];

  const keys = Object.keys(obj).sort((a, b) => {
    const ia = canon.indexOf(a);
    const ib = canon.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });

  const getLabel = (key: string) => {
    switch (key) {
      case "prompt_tokens":
        return t("detailAttrTokenPrompt");
      case "completion_tokens":
        return t("detailAttrTokenCompletion");
      case "cache_read_tokens":
        return t("detailAttrTokenCacheRead");
      case "total_tokens":
        return t("colTotalTokens");
      default:
        return key;
    }
  };

  return (
    <div className="min-w-[14rem] space-y-3 py-1 text-left">
      <div className="flex items-center gap-2 border-b border-neutral-100 pb-2">
        <IconCommon className="size-4 text-violet-500" />
        <span className="text-sm font-bold text-neutral-800">{t("semanticTokenUsageTitle")}</span>
      </div>
      <div className="grid grid-cols-1 gap-y-2.5">
        {keys.map((k) => {
          const isTotal = k === "total_tokens";
          return (
            <div key={k} className={cn("flex items-center justify-between gap-4 text-xs", isTotal && "mt-1 border-t border-neutral-100 pt-2 font-bold")}>
              <span className={cn("text-neutral-500", isTotal && "text-neutral-700")}>{getLabel(k)}</span>
              <span className={cn("tabular-nums text-neutral-800", isTotal && "text-violet-600")}>
                {obj[k].toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
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
    (node.type === "TOOL" || node.type === "IO" || node.type === "MEMORY" || node.type === "PLUGIN");
  const when = formatTraceDateTimeLocal(new Date(node.start_time).toISOString());
  const dur = durationMs(node);
  const path = ioPathFromInput(node.input);
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
            "flex w-full flex-col gap-1.5 rounded-lg border px-2.5 py-2 text-left text-sm transition outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            active
              ? "border-sky-300 bg-sky-50 shadow-sm ring-2 ring-sky-200/80"
              : decisionBranch
                ? "border-amber-200/90 bg-amber-50/50 hover:border-amber-300 hover:bg-amber-50/80"
                : "border-neutral-200/90 bg-white hover:border-neutral-300 hover:bg-neutral-50/80",
          )}
          style={{ marginLeft: depth * 12 }}
        >
          <div className="flex items-start gap-2">
            <span
              className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-pink-100 text-[10px] font-bold text-pink-700"
              aria-hidden
            >
              {node.type.slice(0, 1)}
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
                   {formatDurSeconds(dur)}
                 </span>
                {showTokens && totalTok != null ? (
                  <Popover
                    position="rt"
                    trigger="hover"
                    content={<InspectTokenUsagePopover node={node} />}
                  >
                    <span
                      className="inline-flex max-w-full cursor-default items-center gap-0.5 rounded-sm text-left text-neutral-600 hover:text-neutral-900"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <IconCommon className="size-3 shrink-0 text-neutral-400" aria-hidden />
                      <span>{totalTok.toLocaleString()}</span>
                      {typeof pt === "number" && typeof ct === "number" ? (
                        <>
                          <span className="mx-0.5 text-neutral-300">·</span>
                          <IconSwap className="size-3 shrink-0 text-neutral-400" aria-hidden />
                          <span>
                            {pt.toLocaleString()}/{ct.toLocaleString()}
                          </span>
                        </>
                      ) : null}
                    </span>
                  </Popover>
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
              {largeFile || fatTool ? (
                <p className="mt-1 text-[9px] text-amber-800">
                  {largeFile ? t("semanticLargeFileBadge") : t("semanticLargeResultBadge")}
                </p>
              ) : null}
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
      <button
        type="button"
        onClick={() => onSelect(node.span_id)}
        title={decisionBranch ? t("semanticDecisionNodeTitle") : undefined}
        className={[
          "flex w-full flex-col gap-1 rounded-xl border px-3 py-2 text-left text-sm transition",
          active
            ? "border-primary bg-white shadow-md ring-2 ring-primary/35"
            : decisionBranch
              ? "border-amber-300/90 bg-amber-50/40 ring-2 ring-amber-400/55 hover:border-amber-400 hover:bg-amber-50/70"
              : "border-border/80 bg-white/90 hover:border-border hover:bg-white",
        ].join(" ")}
        style={{ marginLeft: depth * 14 }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ${typeBadgeClass(node.type)}`}>
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
    <div className={cn("space-y-3", variant === "default" ? "p-3 sm:p-4" : "px-2 py-2 sm:px-3")}>
      {treeBody}
    </div>
  );
}
