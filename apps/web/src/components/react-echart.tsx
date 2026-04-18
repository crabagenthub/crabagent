"use client";

import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import type { CSSProperties } from "react";

type ReactEChartProps = {
  option: EChartsOption;
  className?: string;
  style?: CSSProperties;
  onEvents?: Record<string, (params: unknown) => void>;
};

/** 客户端 ECharts 容器，占满父级高度（父级需有明确 height） */
export function ReactEChart({ option, className, style, onEvents }: ReactEChartProps) {
  return (
    <ReactECharts
      className={className}
      option={option}
      notMerge
      onEvents={onEvents}
      style={{ width: "100%", height: "100%", minHeight: 0, ...style }}
    />
  );
}
