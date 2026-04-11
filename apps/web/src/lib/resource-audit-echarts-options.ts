import type { EChartsOption } from "echarts";

const MUTED = "#64748b";

export function resourceDailyIoOption(
  rows: { day: string; n: number; avg: number }[],
  labelEvents: string,
  labelAvgMs: string,
): EChartsOption {
  return {
    grid: { left: 4, right: 48, top: 28, bottom: 4, containLabel: true },
    tooltip: { trigger: "axis", textStyle: { fontSize: 12 } },
    legend: { top: 0, textStyle: { fontSize: 11, color: MUTED } },
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
