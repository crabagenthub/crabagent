"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Space, Spin, Tag, Typography } from "@arco-design/web-react";
import { COLLECTOR_QUERY_SCOPE } from "@/lib/collector-api-paths";
import { loadResourceAuditEvents, type ResourceAuditEventRow } from "@/lib/resource-audit-records";
import { loadSecurityAuditEvents, parseSecurityAuditFindings } from "@/lib/security-audit-records";
import { formatShortId } from "@/lib/utils";

type Props = {
  baseUrl: string;
  apiKey: string;
  traceId: string;
  spanId: string | null;
  open: boolean;
};

function raFlagLabel(
  t: ReturnType<typeof useTranslations<"ResourceAudit">>,
  f: string,
): string {
  switch (f) {
    case "sensitive_path":
      return t("flagSensitivePath");
    case "pii_hint":
      return t("flagPiiHint");
    case "large_read":
      return t("flagLargeRead");
    case "redundant_read":
      return t("flagRedundantRead");
    default:
      return f;
  }
}

function raFlagColor(f: string): string {
  if (f === "sensitive_path") {
    return "red";
  }
  if (f === "pii_hint") {
    return "orangered";
  }
  if (f === "large_read") {
    return "orange";
  }
  if (f === "redundant_read") {
    return "arcoblue";
  }
  return "gray";
}

function ResourceFlags({
  row,
  tRa,
}: {
  row: ResourceAuditEventRow;
  tRa: ReturnType<typeof useTranslations<"ResourceAudit">>;
}) {
  const flags = row.risk_flags ?? [];
  if (!flags.length) {
    return null;
  }
  return (
    <Space size={4} wrap className="mt-1">
      {flags.map((f) => (
        <Tag key={f} size="small" color={raFlagColor(f)}>
          {raFlagLabel(tRa, f)}
        </Tag>
      ))}
    </Space>
  );
}

/** Span 抽屉内：当前选中 Span 的访问审计摘要 + 内容审计入口（与 Trace / 安全策略页联动） */
export function SpanInspectAuditBridge({ baseUrl, apiKey, traceId, spanId, open }: Props) {
  const tTr = useTranslations("Traces");
  const tRa = useTranslations("ResourceAudit");
  const sid = spanId?.trim() ?? "";
  const enabled = open && baseUrl.trim().length > 0 && traceId.length > 0 && sid.length > 0;

  const resourceQ = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.resourceAuditEvents, "span-bridge-ra", baseUrl, apiKey, traceId, sid],
    queryFn: () =>
      loadResourceAuditEvents(baseUrl, apiKey, {
        trace_id: traceId,
        span_id: sid,
        limit: 1,
        offset: 0,
        order: "desc",
      }),
    enabled,
    staleTime: 15_000,
  });

  const securityQ = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.securityAuditEvents, "span-bridge-sec", baseUrl, apiKey, traceId, sid],
    queryFn: () =>
      loadSecurityAuditEvents(baseUrl, apiKey, {
        traceId,
        spanId: sid,
        limit: 8,
        offset: 0,
        order: "desc",
      }),
    enabled,
    staleTime: 15_000,
  });

  const ra = resourceQ.data?.items?.[0];
  const secTotal = securityQ.data?.total ?? 0;
  const secPreview = securityQ.data?.items?.[0];
  const previewPolicies = secPreview ? parseSecurityAuditFindings(secPreview.findings_json) : [];

  if (!sid) {
    return (
      <div className="mt-4 border-t border-border pt-3">
        <div className="text-xs font-semibold text-neutral-800 dark:text-neutral-100">
          {tTr("spanInspectAuditSectionTitle")}
        </div>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          {tTr("spanInspectAuditSelectSpanHint")}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3 border-t border-border pt-3">
      <div className="text-xs font-semibold text-neutral-800 dark:text-neutral-100">
        {tTr("spanInspectAuditSectionTitle")}
      </div>

      <div>
        <div className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
          {tTr("spanInspectResourceBlock")}
        </div>
        {resourceQ.isFetching && !resourceQ.data ? (
          <Spin className="mt-2" size={16} />
        ) : ra ? (
          <div className="mt-1">
            <Typography.Text className="text-xs" ellipsis={{ rows: 2, showTooltip: true }}>
              {ra.resource_uri || "—"}
            </Typography.Text>
            <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-neutral-500">
              {ra.access_mode ? <span>{ra.access_mode}</span> : null}
              {ra.chars != null ? <span>{ra.chars.toLocaleString()} chars</span> : null}
            </div>
            <ResourceFlags row={ra} tRa={tRa} />
            <div className="mt-2">
              <Link
                href={`/resource-audit?trace_id=${encodeURIComponent(traceId)}`}
                className="text-xs font-medium text-primary underline-offset-2 hover:underline"
              >
                {tTr("spanInspectOpenResourceAudit")}
              </Link>
            </div>
          </div>
        ) : (
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {tTr("spanInspectNoResourceAudit")}
          </p>
        )}
      </div>

      <div>
        <div className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
          {tTr("spanInspectSecurityBlock")}
        </div>
        {securityQ.isFetching && !securityQ.data ? (
          <Spin className="mt-2" size={16} />
        ) : secTotal > 0 ? (
          <div className="mt-1">
            <p className="text-xs text-neutral-700 dark:text-neutral-200">
              {tTr("spanInspectSecurityHits", { n: String(secTotal) })}
            </p>
            {previewPolicies.length > 0 ? (
              <Typography.Text className="mt-0.5 block text-[11px] text-neutral-500" ellipsis={{ rows: 2, showTooltip: true }}>
                {previewPolicies.map((p) => `${p.policy_name}×${p.match_count}`).join(", ")}
              </Typography.Text>
            ) : null}
          </div>
        ) : (
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {tTr("spanInspectNoSecurityHits")}
          </p>
        )}
      </div>

      <div className="text-[10px] text-neutral-400 dark:text-neutral-500">
        {tTr("spanInspectAuditTraceHint", { id: formatShortId(traceId) })}
      </div>
    </div>
  );
}
