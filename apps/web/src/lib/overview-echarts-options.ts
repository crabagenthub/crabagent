import type { EChartsOption } from "echarts";
import type { NamedPct } from "@/lib/overview-metrics";

export const OV_CHART_PRIMARY = "#7c3aed";
export const OV_CHART_SECONDARY = "#14b8a6";
/** 总消耗折线 / 柱（与 Input+Output 一致，便于图例与 tooltip 展示） */
export const OV_CHART_TOTAL = "#475569";
export const OV_PIE_COLORS = ["#7c3aed", "#14b8a6", "#f59e0b", "#ec4899", "#3b82f6", "#64748b"];

const MUTED = "#64748b";
const GRID_LEGEND = { left: 4, right: 10, top: 8, bottom: 36, containLabel: true } as const;

function dayLabels(days: string[]) {
  return days.map((d) => (d.length >= 10 ? d.slice(5) : d));
}

function axisTooltip(): EChartsOption["tooltip"] {
  return {
    trigger: "axis",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "hsl(214.3 31.8% 91.4%)",
    textStyle: { fontSize: 12 },
  };
}

function xAxisCategory(days: string[]): EChartsOption["xAxis"] {
  return {
    type: "category",
    /** 与原先 Recharts 一致：首尾数据点对齐 Y 轴，不在类目两侧留白 */
    boundaryGap: false,
    data: dayLabels(days),
    axisLabel: { fontSize: 11, color: MUTED },
    axisLine: { lineStyle: { color: MUTED } },
    splitLine: { show: false },
  } as EChartsOption["xAxis"];
}

function yAxisValue(extra?: Record<string, unknown>): EChartsOption["yAxis"] {
  return {
    type: "value",
    axisLabel: { fontSize: 11, color: MUTED },
    splitLine: { lineStyle: { type: "dashed", color: "rgba(148, 163, 184, 0.35)" } },
    ...extra,
  } as EChartsOption["yAxis"];
}

function axisTickLabel(params: unknown): string {
  const p = params as { axisValueLabel?: string; name?: string };
  return p.axisValueLabel ?? p.name ?? "";
}

// hex to rgba helper
function hexAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

export type TokenSplitChartMode = "line" | "bar";

function xAxisTokenTrend(days: string[], barMode: boolean): EChartsOption["xAxis"] {
  return {
    type: "category",
    boundaryGap: barMode,
    data: days,
    axisLabel: { fontSize: 11, color: MUTED },
    axisLine: { lineStyle: { color: MUTED } },
    splitLine: { show: false },
  } as EChartsOption["xAxis"];
}

export function tokenSplitOption(
  rows: { day: string; input: number; output: number }[],
  yAxisName: string,
  legendInput: string,
  legendOutput: string,
  legendTotal: string,
  mode: TokenSplitChartMode = "line",
): EChartsOption {
  const days = rows.map((r) => r.day);
  const totalData = rows.map((r) => Math.round((r.input + r.output) * 100) / 100);
  const tooltipOrder = [legendTotal, legendInput, legendOutput];
  const tooltipFmt: EChartsOption["tooltip"] = {
    ...axisTooltip(),
    formatter: (params) => {
      const arr = Array.isArray(params) ? params : [params];
      const byName = new Map(arr.map((p) => [String(p.seriesName), p]));
      const lines = tooltipOrder
        .map((name) => {
          const p = byName.get(name);
          return p ? `${p.marker} ${p.seriesName}: ${p.value}` : null;
        })
        .filter(Boolean);
      return `${axisTickLabel(arr[0])}<br/>${lines.join("<br/>")}`;
    },
  };
  const yAxisToken = {
    ...yAxisValue(),
    name: yAxisName,
    nameTextStyle: { fontSize: 10, color: MUTED },
    nameLocation: "middle" as const,
    nameGap: 36,
  };

  const legendToken = {
    bottom: 0,
    textStyle: { fontSize: 12, color: MUTED },
    data: [legendTotal, legendInput, legendOutput],
  };

  if (mode === "bar") {
    return {
      grid: GRID_LEGEND,
      tooltip: tooltipFmt,
      legend: legendToken,
      xAxis: xAxisTokenTrend(days, true),
      yAxis: yAxisToken,
      series: [
        {
          name: legendInput,
          type: "bar",
          data: rows.map((r) => r.input),
          itemStyle: { color: OV_CHART_PRIMARY, borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 16,
        },
        {
          name: legendOutput,
          type: "bar",
          data: rows.map((r) => r.output),
          itemStyle: { color: OV_CHART_SECONDARY, borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 16,
        },
        {
          name: legendTotal,
          type: "bar",
          data: totalData,
          itemStyle: { color: OV_CHART_TOTAL, borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 16,
        },
      ],
    };
  }

  return {
    grid: GRID_LEGEND,
    tooltip: tooltipFmt,
    legend: legendToken,
    xAxis: xAxisTokenTrend(days, false),
    yAxis: yAxisToken,
    series: [
      {
        name: legendInput,
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 6,
        showSymbol: true,
        data: rows.map((r) => r.input),
        lineStyle: { width: 2, color: OV_CHART_PRIMARY },
        itemStyle: { color: OV_CHART_PRIMARY },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: hexAlpha(OV_CHART_PRIMARY, 0.35) },
              { offset: 1, color: hexAlpha(OV_CHART_PRIMARY, 0.02) },
            ],
          },
        },
      },
      {
        name: legendOutput,
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 6,
        showSymbol: true,
        data: rows.map((r) => r.output),
        lineStyle: { width: 2, color: OV_CHART_SECONDARY },
        itemStyle: { color: OV_CHART_SECONDARY },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: hexAlpha(OV_CHART_SECONDARY, 0.3) },
              { offset: 1, color: hexAlpha(OV_CHART_SECONDARY, 0.02) },
            ],
          },
        },
      },
      {
        name: legendTotal,
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 6,
        showSymbol: true,
        z: 3,
        data: totalData,
        lineStyle: { width: 2, type: "dashed", color: OV_CHART_TOTAL },
        itemStyle: { color: OV_CHART_TOTAL },
      },
    ],
  };
}

export function areaSingleOption(
  rows: { day: string; v: number }[],
  valueLabel: string,
  valueFormatter?: (n: number) => string,
  yAxisLabelSuffix?: string,
): EChartsOption {
  const days = rows.map((r) => r.day);
  const fmt = valueFormatter ?? ((n: number) => String(n));
  const yAxis: EChartsOption["yAxis"] = yAxisLabelSuffix
    ? {
        type: "value",
        axisLabel: {
          fontSize: 11,
          color: MUTED,
          formatter: (val: number | string) => `${val}${yAxisLabelSuffix}`,
        },
        splitLine: { lineStyle: { type: "dashed", color: "rgba(148, 163, 184, 0.35)" } },
      }
    : yAxisValue();
  return {
    grid: GRID_LEGEND,
    tooltip: {
      ...axisTooltip(),
      formatter: (params) => {
        const p = Array.isArray(params) ? params[0] : params;
        const v = Number(p.value);
        return `${axisTickLabel(p)}<br/>${p.marker} ${fmt(v)}`;
      },
    },
    legend: {
      bottom: 0,
      textStyle: { fontSize: 12, color: MUTED },
      data: [valueLabel],
    },
    xAxis: xAxisCategory(days),
    yAxis,
    series: [
      {
        type: "line",
        name: valueLabel,
        smooth: true,
        symbol: "none",
        data: rows.map((r) => r.v),
        lineStyle: { width: 2, color: OV_CHART_PRIMARY },
        itemStyle: { color: OV_CHART_PRIMARY },
        areaStyle: { color: hexAlpha(OV_CHART_PRIMARY, 0.15) },
      },
    ],
  };
}

export function lineSingleOption(
  rows: { day: string; v: number }[],
  showDot: boolean,
  color = OV_CHART_PRIMARY,
  valueFormatter?: (n: number) => string,
  integerY?: boolean,
  legendName?: string,
): EChartsOption {
  const days = rows.map((r) => r.day);
  const fmt = valueFormatter ?? ((n: number) => String(n));
  const seriesName = legendName ?? "Value";
  return {
    grid: GRID_LEGEND,
    tooltip: {
      ...axisTooltip(),
      formatter: (params) => {
        const p = Array.isArray(params) ? params[0] : params;
        const v = Number(p.value);
        return `${axisTickLabel(p)}<br/>${p.marker} ${fmt(v)}`;
      },
    },
    legend: {
      bottom: 0,
      textStyle: { fontSize: 12, color: MUTED },
      data: [seriesName],
    },
    xAxis: xAxisCategory(days),
    yAxis: yAxisValue(integerY ? { minInterval: 1 } : {}),
    series: [
      {
        type: "line",
        name: seriesName,
        smooth: true,
        symbol: showDot ? "circle" : "none",
        symbolSize: showDot ? 6 : 0,
        data: rows.map((r) => r.v),
        lineStyle: { width: 2, color },
        itemStyle: { color },
      },
    ],
  };
}

export function areaPercentOption(rows: { day: string; rate: number }[], rateLabel: string): EChartsOption {
  const days = rows.map((r) => r.day);
  return {
    grid: GRID_LEGEND,
    tooltip: {
      ...axisTooltip(),
      formatter: (params) => {
        const p = Array.isArray(params) ? params[0] : params;
        const v = Number(p.value);
        return `${axisTickLabel(p)}<br/>${p.marker} ${v.toFixed(1)}%`;
      },
    },
    legend: {
      bottom: 0,
      textStyle: { fontSize: 12, color: MUTED },
      data: [rateLabel],
    },
    xAxis: xAxisCategory(days),
    yAxis: yAxisValue({
      min: 0,
      max: 100,
      axisLabel: { formatter: "{value}%" },
    }),
    series: [
      {
        type: "line",
        name: rateLabel,
        smooth: true,
        symbol: "none",
        data: rows.map((r) => r.rate),
        lineStyle: { width: 2, color: OV_CHART_PRIMARY },
        itemStyle: { color: OV_CHART_PRIMARY },
        areaStyle: { color: hexAlpha(OV_CHART_PRIMARY, 0.12) },
      },
    ],
  };
}

export function pieNamedPctOption(
  items: NamedPct[],
  callsLabel: string,
): EChartsOption {
  const data = items.map((d, i) => ({
    name: d.name,
    value: d.value,
    pct: d.pct,
    itemStyle: { color: OV_PIE_COLORS[i % OV_PIE_COLORS.length] },
  }));
  return {
    tooltip: {
      trigger: "item",
      textStyle: { fontSize: 12 },
      formatter: (p) => {
        const datum = p as { name: string; value: number; data?: { pct?: number } };
        const pctStr = datum.data?.pct != null ? datum.data.pct.toFixed(1) : "";
        return pctStr
          ? `${datum.name}<br/>${callsLabel}: ${datum.value} (${pctStr}%)`
          : `${datum.name}<br/>${callsLabel}: ${datum.value}`;
      },
    },
    legend: { orient: "vertical", left: "left", top: "center", textStyle: { fontSize: 11, color: MUTED } },
    series: [
      {
        type: "pie",
        radius: "88%",
        center: ["58%", "50%"],
        data,
        label: { formatter: "{b}", fontSize: 11 },
      },
    ],
  };
}

export function pieSimpleOption(items: NamedPct[]): EChartsOption {
  const data = items.map((d, i) => ({
    name: d.name,
    value: d.value,
    itemStyle: { color: OV_PIE_COLORS[i % OV_PIE_COLORS.length] },
  }));
  return {
    tooltip: { trigger: "item", textStyle: { fontSize: 12 }, confine: true },
    legend: { orient: "vertical", left: "left", top: "center", textStyle: { fontSize: 11, color: MUTED } },
    series: [
      {
        type: "pie",
        radius: "88%",
        center: ["58%", "50%"],
        data,
        label: { formatter: "{b}", fontSize: 11 },
      },
    ],
  };
}
