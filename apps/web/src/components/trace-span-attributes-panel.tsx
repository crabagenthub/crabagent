"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { formatTraceDateTimeLocal } from "@/lib/trace-datetime";
import type { SemanticSpanRow } from "@/lib/semantic-spans";
import { spanTokenTotals } from "@/lib/span-token-display";

function dash(v: string): string {
  return v.trim().length > 0 ? v : "—";
}

function AttrRow({
  label,
  value,
  mono,
  children,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-neutral-200/80 py-2.5 last:border-b-0">
      <span className="text-[11px] font-medium text-neutral-500">{label}</span>
      {children ?? (
        <span className={`text-xs text-neutral-900 ${mono ? "break-all font-mono" : ""}`}>{value}</span>
      )}
    </div>
  );
}

function providerGuess(span: SemanticSpanRow): string {
  const m = span.metadata;
  if (m && typeof m === "object") {
    const p = (m as Record<string, unknown>).modelProvider ?? m.provider ?? m.model_provider;
    if (typeof p === "string" && p.trim()) {
      return p.trim();
    }
  }
  const inp = span.input;
  if (inp && typeof inp === "object") {
    const p = (inp as Record<string, unknown>).provider ?? (inp as Record<string, unknown>).modelProvider;
    if (typeof p === "string" && p.trim()) {
      return p.trim();
    }
  }
  const mn = span.model_name?.trim();
  if (mn && mn.includes("/")) {
    return mn.split("/")[0]!.trim();
  }
  return "";
}

export function TraceSpanAttributesPanel({ span }: { span: SemanticSpanRow | null }) {
  const t = useTranslations("Traces");
  const [copied, setCopied] = useState(false);

  const copyId = useCallback(() => {
    if (!span?.span_id) {
      return;
    }
    void navigator.clipboard.writeText(span.span_id).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }, [span?.span_id]);

  if (!span) {
    return (
      <div className="flex h-full min-h-[160px] flex-col justify-center border-t border-border bg-neutral-50/50 p-4 text-center xl:border-l xl:border-t-0">
        <p className="text-xs text-ca-muted">{t("inspectorEmpty")}</p>
      </div>
    );
  }

  const durationMs =
    span.end_time != null && Number.isFinite(span.start_time) && Number.isFinite(span.end_time)
      ? Math.max(0, span.end_time - span.start_time)
      : null;

  const startLabel = formatTraceDateTimeLocal(new Date(span.start_time).toISOString());
  const tok = spanTokenTotals(span);
  const prov = providerGuess(span);
  const stream = span.metadata && typeof span.metadata === "object" ? (span.metadata as Record<string, unknown>).stream : undefined;

  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col border-t border-border bg-neutral-50/40 lg:border-l lg:border-t-0">
      <div className="shrink-0 border-b border-border bg-white/90 px-3 py-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{t("detailAttrPanelTitle")}</h3>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-1">
        <AttrRow label={t("detailAttrStatus")}>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium">
            <span
              className={[
                "h-2 w-2 rounded-full",
                span.error ? "bg-red-500" : "bg-emerald-500",
              ].join(" ")}
              aria-hidden
            />
            {span.error ? t("detailStatusError") : t("detailStatusSuccess")}
          </span>
        </AttrRow>
        <AttrRow label={t("detailAttrSpanId")}>
          <div className="flex items-start gap-1.5">
            <span className="min-w-0 flex-1 break-all font-mono text-[11px] text-neutral-900">{span.span_id}</span>
            <button
              type="button"
              onClick={copyId}
              className="shrink-0 rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-neutral-600 hover:bg-neutral-50"
            >
              {copied ? t("detailCopied") : t("detailCopy")}
            </button>
          </div>
        </AttrRow>
        <AttrRow label={t("detailAttrType")} value={span.type} />
        <AttrRow
          label={t("detailAttrLatency")}
          value={durationMs != null ? `${durationMs.toLocaleString()} ms` : "—"}
        />
        <AttrRow label={t("detailAttrStartTime")} value={startLabel} />
        <AttrRow label={t("detailAttrModelProvider")} value={dash(prov)} mono />
        <AttrRow label={t("detailAttrModelName")} value={dash(span.model_name ?? "")} mono />
        <AttrRow
          label={t("detailAttrTokens")}
          value={tok.displayTotal != null ? tok.displayTotal.toLocaleString() : "—"}
        />
        {tok.hasAny ? (
          <div className="flex flex-col gap-1 border-b border-neutral-200/80 pb-2.5 text-[11px] text-neutral-700">
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums">
              <span>
                {t("detailAttrTokenPrompt")}: {tok.prompt.toLocaleString()}
              </span>
              <span>
                {t("detailAttrTokenCompletion")}: {tok.completion.toLocaleString()}
              </span>
              {tok.cacheRead > 0 ? (
                <span>
                  {t("detailAttrTokenCacheRead")}: {tok.cacheRead.toLocaleString()}
                </span>
              ) : null}
            </div>
            {Object.keys(span.usage_breakdown ?? {}).length > 0 ? (
              <details className="mt-1">
                <summary className="cursor-pointer text-[10px] font-medium text-neutral-500">
                  {t("detailAttrTokenUsageJson")}
                </summary>
                <pre className="mt-1 max-h-32 overflow-auto rounded border border-neutral-200/80 bg-white p-2 font-mono text-[10px] leading-relaxed text-neutral-800">
                  {(() => {
                    const keys = Object.keys(span.usage_breakdown ?? {}).sort();
                    const lines = keys.map((k) => `  "${k}": ${(span.usage_breakdown as Record<string, number>)[k]}`);
                    return `{\n${lines.join("\n")}\n}`;
                  })()}
                </pre>
              </details>
            ) : null}
          </div>
        ) : null}
        <AttrRow label={t("detailAttrModule")} value={dash(span.module)} mono />
        <AttrRow
          label={t("detailAttrStream")}
          value={typeof stream === "boolean" ? (stream ? t("detailYes") : t("detailNo")) : "—"}
        />
        {span.error ? <AttrRow label={t("detailAttrError")} value={span.error} /> : null}
      </div>
    </aside>
  );
}
