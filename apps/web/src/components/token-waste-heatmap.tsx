"use client";

import { useTranslations } from "next-intl";
import { ListEmptyState } from "@/components/list-empty-state";
import { LocalizedLink } from "@/components/localized-link";
import type { TokenWasteThreadRow } from "@/lib/token-waste-heatmap";

function cellBackground(heat: number, hasData: boolean): string {
  if (!hasData) {
    return "bg-neutral-100/90";
  }
  if (heat < 0.17) {
    return "bg-emerald-100/95";
  }
  if (heat < 0.34) {
    return "bg-lime-100/95";
  }
  if (heat < 0.51) {
    return "bg-amber-100/95";
  }
  if (heat < 0.68) {
    return "bg-orange-200/95";
  }
  return "bg-red-300/90";
}

function shortThreadLabel(s: string, max = 28): string {
  const t = s.trim();
  if (t.length <= max) {
    return t || "—";
  }
  return `${t.slice(0, max - 1)}…`;
}

export function TokenWasteHeatmap(props: {
  rows: TokenWasteThreadRow[];
  maxTurnCols: number;
}) {
  const t = useTranslations("Analytics");
  const { rows, maxTurnCols } = props;

  if (rows.length === 0) {
    return (
      <ListEmptyState
        variant="card"
        title={t("wasteHeatmapEmptyTitle")}
        description={t("wasteHeatmapEmpty")}
        footer={
          <LocalizedLink href="/traces" className="ca-btn-secondary inline-flex text-sm no-underline">
            {t("wasteHeatmapOpenTraces")}
          </LocalizedLink>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border border-ca-shell-border bg-white/80 shadow-sm">
        <table className="min-w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-ca-shell-border bg-neutral-50/90">
              <th
                scope="col"
                className="sticky left-0 z-20 min-w-[10rem] max-w-[14rem] border-r border-ca-shell-border px-3 py-2.5 font-semibold text-ca-shell-text"
              >
                {t("wasteHeatmapColConversation")}
              </th>
              {Array.from({ length: maxTurnCols }, (_, j) => (
                <th
                  key={j}
                  scope="col"
                  className="w-10 min-w-[2.25rem] px-0.5 py-2.5 text-center font-semibold text-ca-muted"
                >
                  {j + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.threadKey} className="border-b border-ca-shell-border/80 last:border-b-0">
                <th
                  scope="row"
                  className="sticky left-0 z-10 min-w-[10rem] max-w-[14rem] border-r border-ca-shell-border bg-ca-shell-sidebar/95 px-3 py-2 align-middle font-normal backdrop-blur-sm"
                >
                  <LocalizedLink
                    href={`/traces/${encodeURIComponent(row.threadKey)}`}
                    className="block truncate text-ca-shell-text underline-offset-2 hover:underline"
                    title={row.label}
                  >
                    {shortThreadLabel(row.label)}
                  </LocalizedLink>
                </th>
                {Array.from({ length: maxTurnCols }, (_, j) => {
                  const cell = row.turns[j];
                  if (!cell) {
                    return (
                      <td key={j} className="border-l border-ca-shell-border/40 p-0.5 align-middle">
                        <div className="mx-auto h-7 w-7 rounded-md bg-neutral-50/80" aria-hidden />
                      </td>
                    );
                  }
                  const title = cell.hasData
                    ? [
                        t("wasteTooltipPreview", { text: cell.userPreview }),
                        t("wasteTooltipPrompt", { n: cell.promptTokens }),
                        t("wasteTooltipCompletion", { n: cell.completionTokens }),
                        t("wasteTooltipRounds", { n: cell.llmRoundCount }),
                        t("wasteTooltipHeat", { pct: Math.round(cell.heat * 100) }),
                      ].join("\n")
                    : t("wasteTooltipNoLlm");
                  return (
                    <td key={j} className="border-l border-ca-shell-border/40 p-0.5 align-middle">
                      <div
                        role="img"
                        aria-label={title}
                        title={title}
                        className={[
                          "mx-auto flex h-7 w-7 items-center justify-center rounded-md text-[10px] font-semibold tabular-nums text-neutral-800/90 ring-1 ring-black/5",
                          cellBackground(cell.heat, cell.hasData),
                        ].join(" ")}
                      >
                        {cell.hasData ? Math.round(cell.heat * 100) : "—"}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-ca-muted">
        <span className="font-medium text-ca-shell-text">{t("wasteLegendLabel")}</span>
        <span className="inline-flex items-center gap-1">
          <span className="h-4 w-4 rounded bg-emerald-100 ring-1 ring-black/5" />
          {t("wasteLegendLow")}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-4 w-4 rounded bg-amber-100 ring-1 ring-black/5" />
          {t("wasteLegendMid")}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-4 w-4 rounded bg-red-300 ring-1 ring-black/5" />
          {t("wasteLegendHigh")}
        </span>
        <span className="text-ca-shell-muted">{t("wasteLegendDash")}</span>
      </div>
    </div>
  );
}
