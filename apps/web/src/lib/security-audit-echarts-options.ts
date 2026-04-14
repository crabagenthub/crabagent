import type { EChartsOption } from "echarts";
import type { SecurityAuditTrendRow, SecurityHitCategory } from "@/lib/security-audit-analytics";

const PIE_COLORS: Record<SecurityHitCategory, string> = {
  pii: "#2563eb",
  secret: "#ea580c",
  injection: "#9333ea",
};

const MUTED = "#64748b";

export function securityTrendBarOption(
  rows: SecurityAuditTrendRow[],
  actionLabel: string,
  auditLabel: string,
): EChartsOption {
  return {
    grid: { left: 4, right: 8, top: 8, bottom: 32, containLabel: true },
    tooltip: { trigger: "axis", textStyle: { fontSize: 12 } },
    legend: { bottom: 0, textStyle: { fontSize: 11, color: MUTED } },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: rows.map((r) => r.date),
      axisLabel: { fontSize: 10, color: MUTED },
      axisLine: { lineStyle: { color: MUTED } },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      axisLabel: { fontSize: 10, color: MUTED },
      splitLine: { lineStyle: { type: "dashed", color: "rgba(148, 163, 184, 0.35)" } },
    },
    series: [
      {
        name: actionLabel,
        type: "bar",
        stack: "hits",
        data: rows.map((r) => r.actionHits),
        itemStyle: { color: "#ea580c" },
      },
      {
        name: auditLabel,
        type: "bar",
        stack: "hits",
        data: rows.map((r) => r.auditHits),
        itemStyle: { color: "#94a3b8" },
      },
    ],
  };
}

export type SecurityPieRow = { name: string; value: number; category: string };

export function securityHitPieOption(rows: SecurityPieRow[]): EChartsOption {
  const data = rows.map((r) => ({
    name: r.name,
    value: r.value,
    itemStyle: { color: PIE_COLORS[r.category as SecurityHitCategory] },
  }));
  return {
    tooltip: { trigger: "item", textStyle: { fontSize: 12 } },
    legend: { bottom: 0, textStyle: { fontSize: 11, color: MUTED } },
    series: [
      {
        type: "pie",
        radius: ["48%", "72%"],
        center: ["50%", "46%"],
        padAngle: 2,
        data,
        label: { fontSize: 10 },
      },
    ],
  };
}

export function securityTopSourcesBarOption(
  labels: string[],
  counts: number[],
  seriesName: string,
): EChartsOption {
  return {
    grid: { left: 4, right: 12, top: 8, bottom: 4, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, textStyle: { fontSize: 12 } },
    xAxis: {
      type: "value",
      minInterval: 1,
      axisLabel: { fontSize: 10, color: MUTED },
      splitLine: { lineStyle: { type: "dashed", color: "rgba(148, 163, 184, 0.35)" } },
    },
    yAxis: {
      type: "category",
      boundaryGap: false,
      data: labels,
      inverse: true,
      axisLabel: { fontSize: 9, color: MUTED, width: 128, overflow: "truncate" },
      axisLine: { lineStyle: { color: MUTED } },
    },
    series: [
      {
        name: seriesName,
        type: "bar",
        data: counts,
        itemStyle: { color: "#6366f1", borderRadius: [0, 4, 4, 0] },
      },
    ],
  };
}
