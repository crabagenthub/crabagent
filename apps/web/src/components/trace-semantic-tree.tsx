"use client";

import { useTranslations } from "next-intl";
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

function TreeNodeRow({
  node,
  depth,
  selectedId,
  onSelect,
  parentType,
}: {
  node: SpanTreeNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Parent span type in the tree; used to highlight LLM → tool/IO/memory branches. */
  parentType: string | null;
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

  return (
    <div className="select-none">
      <button
        type="button"
        onClick={() => onSelect(node.span_id)}
        title={decisionBranch ? t("semanticDecisionNodeTitle") : undefined}
        className={[
          "flex w-full flex-col gap-1 rounded-xl border px-3 py-2 text-left text-sm transition",
          active
            ? "border-ca-accent bg-white shadow-md ring-2 ring-ca-accent/35"
            : decisionBranch
              ? "border-amber-300/90 bg-amber-50/40 ring-2 ring-amber-400/55 hover:border-amber-400 hover:bg-amber-50/70"
              : "border-ca-border/80 bg-white/90 hover:border-ca-border hover:bg-white",
        ].join(" ")}
        style={{ marginLeft: depth * 14 }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ${typeBadgeClass(node.type)}`}>
            {node.type}
          </span>
          <span className="font-mono text-[10px] text-ca-muted">{when}</span>
          {dur != null ? (
            <span className="font-mono text-[10px] tabular-nums text-neutral-500">{dur}ms</span>
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
            {memMeta.path ? <span className="font-mono">{memMeta.path}</span> : null}
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
        <div className="mt-2 space-y-2 border-l border-ca-border/60 pl-2">
          {node.children.map((ch) => (
            <TreeNodeRow
              key={ch.span_id}
              node={ch}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              parentType={node.type}
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
}: {
  forest: SpanTreeNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("Traces");
  if (forest.length === 0) {
    return (
      <p className="px-3 py-6 text-sm text-ca-muted">{t("semanticTreeEmpty")}</p>
    );
  }
  return (
    <div className="space-y-3 p-3 sm:p-4">
      <p className="text-xs leading-relaxed text-ca-muted">{t("semanticTreeHint")}</p>
      <div className="space-y-2">
        {forest.map((n) => (
          <TreeNodeRow
            key={n.span_id}
            node={n}
            depth={0}
            selectedId={selectedId}
            onSelect={onSelect}
            parentType={null}
          />
        ))}
      </div>
    </div>
  );
}
