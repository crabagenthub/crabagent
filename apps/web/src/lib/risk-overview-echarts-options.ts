import type { EChartsOption } from "echarts";

export function riskTrendLineOption(data: { date: string; p0: number; p1: number; p2: number; p3: number }[]): EChartsOption {
  return {
    tooltip: {
      trigger: "axis",
    },
    legend: {
      data: ["P0", "P1", "P2", "P3"],
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: data.map((d) => d.date),
    },
    yAxis: {
      type: "value",
    },
    series: [
      {
        name: "P0",
        type: "line",
        stack: "Total",
        data: data.map((d) => d.p0),
        itemStyle: { color: "#F53F3F" },
      },
      {
        name: "P1",
        type: "line",
        stack: "Total",
        data: data.map((d) => d.p1),
        itemStyle: { color: "#FF7D00" },
      },
      {
        name: "P2",
        type: "line",
        stack: "Total",
        data: data.map((d) => d.p2),
        itemStyle: { color: "#FFC72E" },
      },
      {
        name: "P3",
        type: "line",
        stack: "Total",
        data: data.map((d) => d.p3),
        itemStyle: { color: "#00B42A" },
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

export function riskMultiTrendLineOption(
  data: { date: string; values: number[] }[],
  series: { name: string; color: string }[],
): EChartsOption {
  const maxV = data.reduce((m, d) => {
    const localMax = d.values.reduce((x, y) => (y > x ? y : x), 0);
    return localMax > m ? localMax : m;
  }, 0);
  const yMax = maxV <= 0 ? 1 : Math.ceil(maxV * 1.1);
  return {
    tooltip: {
      trigger: "axis",
    },
    legend: {
      data: series.map((s) => s.name),
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: data.map((d) => d.date),
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      max: yMax,
    },
    series: series.map((s, idx) => ({
      name: s.name,
      type: "line",
      smooth: 0.25,
      symbol: "none",
      data: data.map((d) => d.values[idx] ?? 0),
      itemStyle: { color: s.color },
      lineStyle: { color: s.color, width: 2 },
    })),
  };
}
