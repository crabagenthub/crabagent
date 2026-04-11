import { loadTraceRecords, type TraceRecordRow } from "@/lib/trace-records";

export interface DayActivity {
  day: string;
  dayShort: string;
  value: number;
  formattedValue: string;
  isActive?: boolean;
}

export interface HourActivity {
  hour: number;
  count: number;
  density: number; // 0-1
}

export interface ActivityTimelineData {
  totalTokens: string;
  dayData: DayActivity[];
  hourData: HourActivity[];
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
    return (num / 1_000_000).toFixed(1) + "M";
  } else if (num >= 1_000) {
    return (num / 1_000).toFixed(1) + "K";
  }
  return num.toString();
}

function getDayOfWeek(date: Date): number {
  // 返回 0-6, 0 是周日
  return date.getDay();
}

export async function loadActivityTimelineData(
  baseUrl: string,
  apiKey: string,
  sinceMs: number,
  untilMs: number
): Promise<ActivityTimelineData> {
  try {
    // 加载 trace 数据
    const traces = await loadTraceRecords(baseUrl, apiKey, {
      limit: 2000,
      offset: 0,
      sinceMs,
      untilMs,
    });

    if (!traces.items || traces.items.length === 0) {
      return generateEmptyActivityData();
    }

    // 计算每天的活动数据
    const dayStats = new Map<number, { count: number; tokens: number }>();
    const hourStats = new Map<number, { count: number }>();

    // 初始化数据
    for (let i = 0; i < 7; i++) {
      dayStats.set(i, { count: 0, tokens: 0 });
    }
    for (let i = 0; i < 24; i++) {
      hourStats.set(i, { count: 0 });
    }

    let totalTokens = 0;

    traces.items.forEach((trace: TraceRecordRow) => {
      // 统计每天的数据
      if (trace.start_time) {
        const date = new Date(trace.start_time);
        const dayOfWeek = getDayOfWeek(date);
        const hour = date.getHours();
        
        const dayData = dayStats.get(dayOfWeek);
        if (dayData) {
          dayData.count += 1;
          dayData.tokens += trace.total_tokens || 0;
        }

        const hourData = hourStats.get(hour);
        if (hourData) {
          hourData.count += 1;
        }

        totalTokens += trace.total_tokens || 0;
      }
    });

    // 生成星期数据
    const maxCount = Math.max(...Array.from(dayStats.values()).map(d => d.count), 1);
    const dayData: DayActivity[] = WEEK_DAYS.map((day, index) => {
      const stats = dayStats.get(index) || { count: 0, tokens: 0 };
      return {
        day: day.label,
        dayShort: day.short,
        value: stats.tokens,
        formattedValue: formatCompactNumber(stats.tokens),
        isActive: stats.tokens > 0 && stats.tokens === Math.max(...Array.from(dayStats.values()).map(d => d.tokens)),
      };
    });

    // 生成小时数据
    const maxHourCount = Math.max(...Array.from(hourStats.values()).map(h => h.count), 1);
    const hourData: HourActivity[] = Array.from({ length: 24 }, (_, i) => {
      const stats = hourStats.get(i) || { count: 0 };
      return {
        hour: i,
        count: stats.count,
        density: maxHourCount > 0 ? stats.count / maxHourCount : 0,
      };
    });

    return {
      totalTokens: formatCompactNumber(totalTokens) + (totalTokens >= 1_000_000 ? "M" : "K"),
      dayData,
      hourData,
    };
  } catch (error) {
    console.error("Failed to load activity timeline data:", error);
    return generateEmptyActivityData();
  }
}

function generateEmptyActivityData(): ActivityTimelineData {
  return {
    totalTokens: "0",
    dayData: WEEK_DAYS.map((day) => ({
      day: day.label,
      dayShort: day.short,
      value: 0,
      formattedValue: "0",
      isActive: false,
    })),
    hourData: Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      count: 0,
      density: 0,
    })),
  };
}
