import type { EChartsOption } from "echarts";
import type { NamedPct } from "@/lib/overview-metrics";
import { pieSimpleOption } from "@/lib/overview-echarts-options";

const MUTED = "#64748b";

export function resourceDailyIoOption(
  rows: { day: string; n: number; avg: number }[],
  labelEvents: string,
  labelAvgMs: string,
): EChartsOption {
  return {
    grid: { left: 4, right: 48, top: 8, bottom: 36, containLabel: true },
    tooltip: { trigger: "axis", textStyle: { fontSize: 12 } },
    legend: { bottom: 0, textStyle: { fontSize: 11, color: MUTED } },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: rows.map((r) => r.day),
      axisLabel: { fontSize: 11, color: MUTED },
      axisLine: { lineStyle: { color: MUTED } },
    },
    yAxis: [
      {
        type: "value",
        axisLabel: { fontSize: 11, color: MUTED },
        splitLine: { lineStyle: { type: "dashed", color: "rgba(148, 163, 184, 0.35)" } },
      },
      {
        type: "value",
        position: "right",
        axisLabel: { fontSize: 11, color: MUTED },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: labelEvents,
        type: "line",
        yAxisIndex: 0,
        data: rows.map((r) => r.n),
        smooth: true,
        symbol: "none",
        lineStyle: { width: 2, color: "#7c3aed" },
        itemStyle: { color: "#7c3aed" },
      },
      {
        name: labelAvgMs,
        type: "line",
        yAxisIndex: 1,
        data: rows.map((r) => r.avg),
        smooth: true,
        symbol: "none",
        lineStyle: { width: 2, color: "#14b8a6" },
        itemStyle: { color: "#14b8a6" },
      },
    ],
  };
}

export function resourceClassPieFromNamed(items: { name: string; value: number }[]): EChartsOption {
  const data: NamedPct[] = items.map((d) => ({ name: d.name, value: d.value, pct: 0 }));
  return pieSimpleOption(data);
}

export function resourceRiskBarOption(
  rows: { name: string; value: number }[],
  seriesName: string,
): EChartsOption {
  const colors = ["#ef4444", "#f97316", "#ca8a04"];
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  return {
    grid: { left: 4, right: 16, top: 8, bottom: 4, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, textStyle: { fontSize: 12 } },
    xAxis: {
      type: "value",
      axisLabel: { fontSize: 11, color: MUTED },
      splitLine: { lineStyle: { type: "dashed", color: "rgba(148, 163, 184, 0.35)" } },
    },
    yAxis: {
      type: "category",
      data: sorted.map((r) => r.name),
      axisLabel: { fontSize: 11, color: MUTED, width: 120, overflow: "truncate" },
      axisTick: { show: false },
    },
    series: [
      {
        name: seriesName,
        type: "bar",
        data: sorted.map((r, i) => ({
          value: r.value,
          itemStyle: {
            color: colors[i % colors.length] ?? "#7c3aed",
            borderRadius: [0, 4, 4, 0],
          },
        })),
        barMaxWidth: 18,
      },
    ],
  };
}

export function resourceHBarOption(
  rows: { label: string; value: number }[],
  seriesName: string,
  color = "#7c3aed",
): EChartsOption {
  const sorted = [...rows].sort((a, b) => a.value - b.value);
  return {
    grid: { left: 4, right: 40, top: 8, bottom: 4, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, textStyle: { fontSize: 12 } },
    xAxis: {
      type: "value",
      axisLabel: { fontSize: 11, color: MUTED },
      splitLine: { lineStyle: { type: "dashed", color: "rgba(148, 163, 184, 0.35)" } },
    },
    yAxis: {
      type: "category",
      data: sorted.map((r) => r.label),
      axisLabel: { fontSize: 10, color: MUTED, width: 140, overflow: "truncate" },
      axisTick: { show: false },
    },
    series: [
      {
        name: seriesName,
        type: "bar",
        data: sorted.map((r) => r.value),
        itemStyle: { color, borderRadius: [0, 4, 4, 0] },
        barMaxWidth: 16,
      },
    ],
  };
}
