"use client";

import "@/lib/arco-react19-setup";
import { Typography } from "@arco-design/web-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface DayActivity {
  day: string;
  dayShort: string;
  value: number;
  formattedValue: string;
  isActive?: boolean;
}

interface HourActivity {
  hour: number;
  count: number;
  density: number; // 0-1
}

interface ActivityTimelineProps {
  totalTokens?: string;
  dayData?: DayActivity[];
  hourData?: HourActivity[];
  loading?: boolean;
  className?: string;
}

const WEEK_DAYS = [
  { key: "sun", label: "周日", short: "日" },
  { key: "mon", label: "周一", short: "一" },
  { key: "tue", label: "周二", short: "二" },
  { key: "wed", label: "周三", short: "三" },
  { key: "thu", label: "周四", short: "四" },
  { key: "fri", label: "周五", short: "五" },
  { key: "sat", label: "周六", short: "六" },
];

function formatCompactNumber(num: number): string {
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(2) + "M";
  } else if (num >= 1_000) {
    return (num / 1_000).toFixed(2) + "K";
  }
  return num.toFixed(2);
}

// 主色：紫色 #7c3aed 的 Tailwind 近似值
function getDensityColor(density: number): string {
  // 根据密度返回颜色，从浅紫色到深紫色
  if (density >= 0.8) return "bg-violet-600";
  if (density >= 0.6) return "bg-violet-500";
  if (density >= 0.4) return "bg-violet-400";
  if (density >= 0.2) return "bg-violet-300";
  return "bg-violet-200";
}

// 主色：紫色 #7c3aed 的 Tailwind 近似值
function getDayCellColor(value: number, maxValue: number): string {
  const ratio = value / maxValue;
  if (ratio >= 0.8) return "bg-violet-600 text-white";
  if (ratio >= 0.6) return "bg-violet-500 text-white";
  if (ratio >= 0.4) return "bg-violet-400";
  if (ratio >= 0.2) return "bg-violet-300";
  return "bg-violet-100";
}

export function ActivityTimeline({
  totalTokens,
  dayData,
  hourData,
  loading,
  className,
}: ActivityTimelineProps) {
  const t = useTranslations("Overview");

  // 使用传入的数据或空数据
  const defaultDayData: DayActivity[] = useMemo(() => {
    if (dayData && dayData.length > 0) return dayData;
    
    // 返回空数据结构
    return WEEK_DAYS.map((day) => ({
      day: day.label,
      dayShort: day.short,
      value: 0,
      formattedValue: "0",
      isActive: false,
    }));
  }, [dayData]);

  const defaultHourData: HourActivity[] = useMemo(() => {
    if (hourData && hourData.length > 0) return hourData;
    
    // 返回空数据结构
    return Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      count: 0,
      density: 0,
    }));
  }, [hourData]);

  const maxDayValue = Math.max(...defaultDayData.map(d => d.value), 1);

  // 时间标签
  const timeLabels = [
    { hour: 0, label: "午夜" },
    { hour: 4, label: "凌晨 4 点" },
    { hour: 8, label: "上午 8 点" },
    { hour: 12, label: "中午" },
    { hour: 16, label: "下午 4 点" },
    { hour: 20, label: "晚上 8 点" },
  ];

  if (loading) {
    return (
      <div className={cn("rounded-lg border border-border bg-white p-4", className)}>
        <div className="flex items-center justify-center h-48">
          <div className="text-sm text-muted-foreground">加载中...</div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border border-border bg-white p-4", className)}>
      {/* 标题区域 */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <Typography.Text bold className="text-base block mb-1">
            {t("activityTimelineTitle")}
          </Typography.Text>
          <Typography.Text type="secondary" className="text-xs">
            {t("activityTimelineSubtitle")}
          </Typography.Text>
        </div>
        <Typography.Text bold className="text-base">
          {totalTokens || "0"} token
        </Typography.Text>
      </div>

      {/* 主内容区域 */}
      <div className="flex gap-4">
        {/* 左侧 - 星期网格 */}
        <div className="flex-shrink-0">
          <Typography.Text type="secondary" className="text-xs block mb-2">
            {t("weekLabel")}
          </Typography.Text>
          <div className="grid grid-cols-3 gap-2 w-[280px]">
            {defaultDayData.map((day, index) => (
              <div
                key={index}
                className={cn(
                  "rounded-md p-3 min-h-[80px] flex flex-col justify-between",
                  getDayCellColor(day.value, maxDayValue)
                )}
              >
                <Typography.Text
                  className={cn(
                    "text-xs",
                    day.value / maxDayValue >= 0.4 ? "text-white/80" : "text-muted-foreground"
                  )}
                >
                  {day.day}
                </Typography.Text>
                <Typography.Text
                  bold
                  className={cn(
                    "text-lg",
                    day.value / maxDayValue >= 0.4 ? "text-white" : "text-foreground"
                  )}
                >
                  {day.formattedValue}
                </Typography.Text>
              </div>
            ))}
          </div>
        </div>

        {/* 右侧 - 24小时时间轴 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <Typography.Text type="secondary" className="text-xs">
              {t("hourLabel")}
            </Typography.Text>
            <Typography.Text type="secondary" className="text-xs">
              0 → 23
            </Typography.Text>
          </div>

          {/* 小时柱状图 */}
          <div className="flex items-end gap-[2px] h-[120px] mb-3">
            {defaultHourData.map((hour) => (
              <div
                key={hour.hour}
                className={cn(
                  "flex-1 rounded-t-sm transition-all hover:opacity-80 cursor-pointer",
                  getDensityColor(hour.density)
                )}
                style={{
                  height: `${Math.max(hour.density * 100, 5)}%`,
                  minHeight: "4px",
                }}
                title={`${hour.hour}:00 - ${hour.hour + 1}:00: ${hour.count} 次活动`}
              />
            ))}
          </div>

          {/* 时间标签 */}
          <div className="relative h-6 mb-2">
            {timeLabels.map((label) => (
              <Typography.Text
                key={label.hour}
                type="secondary"
                className="text-xs absolute transform -translate-x-1/2"
                style={{
                  left: `${(label.hour / 23) * 100}%`,
                }}
              >
                {label.label}
              </Typography.Text>
            ))}
          </div>

          {/* 密度说明 */}
          <div className="flex items-center justify-end gap-2 mt-4">
            <Typography.Text type="secondary" className="text-xs">
              {t("lowDensity")}
            </Typography.Text>
            <div className="flex gap-[2px]">
              {[0.1, 0.3, 0.5, 0.7, 0.9].map((density, i) => (
                <div
                  key={i}
                  className={cn("w-4 h-3 rounded-sm", getDensityColor(density))}
                />
              ))}
            </div>
            <Typography.Text type="secondary" className="text-xs">
              {t("highDensity")}
            </Typography.Text>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ActivityTimeline;
