import type { EChartsOption } from "echarts";

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

const P0_COLOR = "#F53F3F";
const P1_COLOR = "#FF7D00";
const P2_COLOR = "#FFC72E";
const P3_COLOR = "#00B42A";

export function riskTrendLineOption(data: { date: string; p0: number; p1: number; p2: number; p3: number }[]): EChartsOption {
  const days = data.map((d) => d.date);
  return {
    grid: GRID_LEGEND,
    tooltip: {
      ...axisTooltip(),
      formatter: (params) => {
        const arr = Array.isArray(params) ? params : [params];
        const lines = arr.map((p) => `${p.marker} ${p.seriesName}: ${p.value}`).join("<br/>");
        return `${axisTickLabel(arr[0])}<br/>${lines}`;
      },
    },
    legend: {
      bottom: 0,
      textStyle: { fontSize: 12, color: MUTED },
      data: ["P0", "P1", "P2", "P3"],
    },
    xAxis: xAxisCategory(days),
    yAxis: yAxisValue({ minInterval: 1 }),
    series: [
      {
        name: "P0",
        type: "line",
        smooth: true,
        symbol: "none",
        data: data.map((d) => d.p0),
        lineStyle: { width: 2, color: P0_COLOR },
        itemStyle: { color: P0_COLOR },
        areaStyle: { color: hexAlpha(P0_COLOR, 0.15) },
      },
      {
        name: "P1",
        type: "line",
        smooth: true,
        symbol: "none",
        data: data.map((d) => d.p1),
        lineStyle: { width: 2, color: P1_COLOR },
        itemStyle: { color: P1_COLOR },
        areaStyle: { color: hexAlpha(P1_COLOR, 0.15) },
      },
      {
        name: "P2",
        type: "line",
        smooth: true,
        symbol: "none",
        data: data.map((d) => d.p2),
        lineStyle: { width: 2, color: P2_COLOR },
        itemStyle: { color: P2_COLOR },
        areaStyle: { color: hexAlpha(P2_COLOR, 0.15) },
      },
      {
        name: "P3",
        type: "line",
        smooth: true,
        symbol: "none",
        data: data.map((d) => d.p3),
        lineStyle: { width: 2, color: P3_COLOR },
        itemStyle: { color: P3_COLOR },
        areaStyle: { color: hexAlpha(P3_COLOR, 0.15) },
      },
    ],
  };
}

export function riskSeverityPieOption(data: { name: string; value: number }[]): EChartsOption {
  return {
    tooltip: {
      trigger: "item",
      formatter: "{a} <br/>{b}: {c} ({d}%)",
    },
    legend: {
      orient: "vertical",
      right: 10,
      top: "center",
    },
    series: [
      {
        name: "风险等级",
        type: "pie",
        radius: ["40%", "70%"],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 10,
          borderColor: "#fff",
          borderWidth: 2,
        },
        label: {
          show: false,
          position: "center",
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 20,
            fontWeight: "bold",
          },
        },
        labelLine: {
          show: false,
        },
        data,
      },
    ],
  };
}

export function eventTypePieOption(data: { name: string; value: number }[]): EChartsOption {
  return {
    tooltip: {
      trigger: "item",
      formatter: "{a} <br/>{b}: {c} ({d}%)",
    },
    legend: {
      orient: "vertical",
      right: 10,
      top: "center",
    },
    series: [
      {
        name: "事件类型",
        type: "pie",
        radius: ["40%", "70%"],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 10,
          borderColor: "#fff",
          borderWidth: 2,
        },
        label: {
          show: false,
          position: "center",
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 20,
            fontWeight: "bold",
          },
        },
        labelLine: {
          show: false,
        },
        data,
      },
    ],
  };
}

export function workspaceBarOption(data: { name: string; value: number }[]): EChartsOption {
  return {
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "shadow",
      },
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      containLabel: true,
    },
    xAxis: {
      type: "value",
    },
    yAxis: {
      type: "category",
      data: data.map((d) => d.name).reverse(),
    },
    series: [
      {
        name: "风险事件数",
        type: "bar",
        data: data.map((d) => d.value).reverse(),
        itemStyle: {
          color: "#165DFF",
        },
      },
    ],
  };
}

export function commandTypePieOption(data: { name: string; value: number }[]): EChartsOption {
  return {
    tooltip: {
      trigger: "item",
      formatter: "{a} <br/>{b}: {c} ({d}%)",
    },
    legend: {
      orient: "vertical",
      right: 10,
      top: "center",
    },
    series: [
      {
        name: "命令类型",
        type: "pie",
        radius: ["40%", "70%"],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 10,
          borderColor: "#fff",
          borderWidth: 2,
        },
        label: {
          show: false,
          position: "center",
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 20,
            fontWeight: "bold",
          },
        },
        labelLine: {
          show: false,
        },
        data,
      },
    ],
  };
}

export function resourceTypePieOption(data: { name: string; value: number }[]): EChartsOption {
  return {
    tooltip: {
      trigger: "item",
      formatter: "{a} <br/>{b}: {c} ({d}%)",
    },
    legend: {
      orient: "vertical",
      right: 10,
      top: "center",
    },
    series: [
      {
        name: "资源类型",
        type: "pie",
        radius: ["40%", "70%"],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 10,
          borderColor: "#fff",
          borderWidth: 2,
        },
        label: {
          show: false,
          position: "center",
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 20,
            fontWeight: "bold",
          },
        },
        labelLine: {
          show: false,
        },
        data,
      },
    ],
  };
}

export function singleMetricLineOption(
  rows: { day: string; count: number }[],
  seriesName: string,
  color: string,
): EChartsOption {
  const days = rows.map((r) => r.day);
  return {
    grid: GRID_LEGEND,
    tooltip: {
      ...axisTooltip(),
      formatter: (params) => {
        const p = Array.isArray(params) ? params[0] : params;
        const v = Number(p.value);
        return `${axisTickLabel(p)}<br/>${p.marker} ${seriesName}: ${v}`;
      },
    },
    legend: {
      bottom: 0,
      textStyle: { fontSize: 12, color: MUTED },
      data: [seriesName],
    },
    xAxis: xAxisCategory(days),
    yAxis: yAxisValue({ minInterval: 1 }),
    series: [
      {
        type: "line",
        name: seriesName,
        smooth: true,
        symbol: "none",
        data: rows.map((r) => r.count),
        lineStyle: { width: 2, color },
        itemStyle: { color },
      },
    ],
  };
}

export function riskMultiTrendLineOption(
  data: { date: string; values: number[] }[],
  series: { name: string; color: string }[],
): EChartsOption {
  const days = data.map((d) => d.date);
  const maxV = data.reduce((m, d) => {
    const localMax = d.values.reduce((x, y) => (y > x ? y : x), 0);
    return localMax > m ? localMax : m;
  }, 0);
  const yMax = maxV <= 0 ? 1 : Math.ceil(maxV * 1.1);
  return {
    grid: GRID_LEGEND,
    tooltip: {
      ...axisTooltip(),
      formatter: (params) => {
        const arr = Array.isArray(params) ? params : [params];
        const lines = arr.map((p) => `${p.marker} ${p.seriesName}: ${p.value}`).join("<br/>");
        return `${axisTickLabel(arr[0])}<br/>${lines}`;
      },
    },
    legend: {
      bottom: 0,
      textStyle: { fontSize: 12, color: MUTED },
      data: series.map((s) => s.name),
    },
    xAxis: xAxisCategory(days),
    yAxis: yAxisValue({ minInterval: 1, max: yMax }),
    series: series.map((s) => ({
      name: s.name,
      type: "line",
      smooth: true,
      symbol: "none",
      data: data.map((d) => d.values[series.findIndex((x) => x.name === s.name)] ?? 0),
      itemStyle: { color: s.color },
      lineStyle: { color: s.color, width: 2 },
      areaStyle: { color: hexAlpha(s.color, 0.12) },
    })),
  };
}
