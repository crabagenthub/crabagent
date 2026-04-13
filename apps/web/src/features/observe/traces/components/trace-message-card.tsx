"use client";

import { useTranslations } from "next-intl";
import { IdLabeledCopy } from "@/shared/components/id-labeled-copy";
import { Button } from "@/shared/ui/button";
import { useRouter } from "@/i18n/navigation";
import { formatTraceDateTimeLocal } from "@/lib/trace-datetime";
import type { TraceMessageRow } from "@/lib/trace-messages";
import { traceMessagePreviewText, traceMessageTimeIso } from "@/lib/trace-messages";

function detailHref(threadKey: string): string {
  return `/traces?thread=${encodeURIComponent(threadKey)}`;
}

export function TraceMessageCard({ row, previewMax }: { row: TraceMessageRow; previewMax: number }) {
  const t = useTranslations("Traces");
  const router = useRouter();
  const tk = typeof row.thread_key === "string" ? row.thread_key.trim() : "";
  const agent =
    (typeof row.agent_name === "string" && row.agent_name.trim()) ||
    (typeof row.agent_id === "string" && row.agent_id.trim()) ||
    "";
  const channel = typeof row.channel === "string" ? row.channel.trim() : "";
  const title = typeof row.chat_title === "string" ? row.chat_title.trim() : "";
  const timeIso = traceMessageTimeIso(row);
  const timeShown = timeIso ? formatTraceDateTimeLocal(timeIso) : "—";
  const preview = traceMessagePreviewText(row, previewMax);

  return (
    <li className="list-none">
      <article className="rounded-2xl border border-border bg-white p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-neutral-500">
              <span className="font-mono tabular-nums">{timeShown}</span>
              {title ? (
                <>
                  <span className="text-neutral-300" aria-hidden>
                    ·
                  </span>
                  <span className="truncate" title={title}>
                    {title}
                  </span>
                </>
              ) : null}
            </div>
            <p className="whitespace-pre-wrap break-words text-sm font-medium leading-snug text-neutral-900">
              {preview || "—"}
            </p>
            <p className="text-[11px] text-neutral-500">
              {[agent, channel].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
          <div className="flex shrink-0 sm:pt-0.5">
            {tk ? (
              <Button type="button" className="w-full sm:w-auto" onClick={() => router.push(detailHref(tk))}>
                {t("openThread")}
              </Button>
            ) : (
              <span className="text-xs text-ca-muted">{t("openThreadDisabled")}</span>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 border-t border-border/80 pt-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ca-muted">{t("threadKeyColumn")}</span>
              <div className="mt-1">
                {tk ? (
                  <IdLabeledCopy kind="thread_key" value={tk} variant="compact" />
                ) : (
                  <span className="text-xs text-neutral-400">—</span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {typeof row.trace_root_id === "string" && row.trace_root_id.trim() ? (
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-ca-muted">{t("traceIdColumn")}</span>
                  <div className="mt-0.5">
                    <IdLabeledCopy kind="trace_id" value={row.trace_root_id.trim()} variant="compact" />
                  </div>
                </div>
              ) : null}
              {typeof row.msg_id === "string" && row.msg_id.trim() ? (
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-ca-muted">{t("msgIdColumn")}</span>
                  <div className="mt-0.5">
                    <IdLabeledCopy kind="msg_id" value={row.msg_id.trim()} variant="compact" />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </article>
    </li>
  );
}
