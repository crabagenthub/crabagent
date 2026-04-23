"use client";

import "@/lib/arco-react19-setup";
import { Button, Input, Space } from "@arco-design/web-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { ObserveDateRangeTrigger } from "@/shared/components/observe-date-range-trigger";
import type { ObserveDateRange } from "@/lib/observe-date-range";
import { defaultObserveDateRange, resolveObserveSinceUntil } from "@/lib/observe-date-range";
import { parseObserveDateRangeFromListUrl } from "@/lib/observe-list-deep-link";

function applyRangeToQuery(sp: URLSearchParams, range: ObserveDateRange): void {
  if (range.kind === "preset" && range.preset === "all") {
    sp.delete("since_ms");
    sp.delete("until_ms");
    return;
  }
  const { sinceMs, untilMs } = resolveObserveSinceUntil(range);
  if (sinceMs != null && sinceMs > 0) {
    sp.set("since_ms", String(Math.floor(sinceMs)));
  } else {
    sp.delete("since_ms");
  }
  if (untilMs != null && untilMs > 0) {
    sp.set("until_ms", String(Math.floor(untilMs)));
  } else {
    sp.delete("until_ms");
  }
}

export function AuditWorkbenchFilterBar({ withChannelAgent }: { withChannelAgent: boolean }) {
  const t = useTranslations("CommandAnalysis");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlRange = useMemo(
    () => parseObserveDateRangeFromListUrl(new URLSearchParams(searchParams.toString())) ?? defaultObserveDateRange(),
    [searchParams],
  );
  const [dateRange, setDateRange] = useState<ObserveDateRange>(urlRange);
  const [traceIdDraft, setTraceIdDraft] = useState(searchParams.get("trace_id")?.trim() ?? "");
  const [channelDraft, setChannelDraft] = useState(searchParams.get("channel")?.trim() ?? "");
  const [agentDraft, setAgentDraft] = useState(searchParams.get("agent")?.trim() ?? "");

  useEffect(() => {
    setDateRange(urlRange);
    setTraceIdDraft(searchParams.get("trace_id")?.trim() ?? "");
    setChannelDraft(searchParams.get("channel")?.trim() ?? "");
    setAgentDraft(searchParams.get("agent")?.trim() ?? "");
  }, [searchParams, urlRange]);

  const commit = useCallback(
    (nextRange: ObserveDateRange, traceId: string, channel: string, agent: string) => {
      const sp = new URLSearchParams(searchParams.toString());
      applyRangeToQuery(sp, nextRange);
      if (traceId.trim()) {
        sp.set("trace_id", traceId.trim());
      } else {
        sp.delete("trace_id");
      }
      if (withChannelAgent && channel.trim()) {
        sp.set("channel", channel.trim());
      } else {
        sp.delete("channel");
      }
      if (withChannelAgent && agent.trim()) {
        sp.set("agent", agent.trim());
      } else {
        sp.delete("agent");
      }
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, router, searchParams, withChannelAgent],
  );

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <Space wrap>
        <ObserveDateRangeTrigger
          value={dateRange}
          onChange={(next) => {
            setDateRange(next);
            commit(next, traceIdDraft, channelDraft, agentDraft);
          }}
        />
        <Input
          placeholder={t("phTraceId")}
          style={{ width: 220 }}
          value={traceIdDraft}
          onChange={setTraceIdDraft}
          onPressEnter={() => commit(dateRange, traceIdDraft, channelDraft, agentDraft)}
        />
        {withChannelAgent ? (
          <Input
            placeholder={t("filterChannel")}
            style={{ width: 150 }}
            value={channelDraft}
            onChange={setChannelDraft}
            onPressEnter={() => commit(dateRange, traceIdDraft, channelDraft, agentDraft)}
          />
        ) : null}
        {withChannelAgent ? (
          <Input
            placeholder={t("filterAgent")}
            style={{ width: 150 }}
            value={agentDraft}
            onChange={setAgentDraft}
            onPressEnter={() => commit(dateRange, traceIdDraft, channelDraft, agentDraft)}
          />
        ) : null}
        <Button type="primary" onClick={() => commit(dateRange, traceIdDraft, channelDraft, agentDraft)}>
          {t("applyFilter")}
        </Button>
      </Space>
    </div>
  );
}

