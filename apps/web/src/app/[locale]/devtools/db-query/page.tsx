"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { CRABAGENT_COLLECTOR_SETTINGS_EVENT } from "@/components/collector-settings-form";
import { LocalizedLink } from "@/components/localized-link";
import { collectorAuthHeaders, loadApiKey, loadCollectorUrl } from "@/lib/collector";
import { computeThreadKey } from "@/lib/compute-thread-key";

type QueryRow = Record<string, unknown>;

/** Matches Collector `events` DDL column order (dev display). */
const EVENTS_COL_ORDER = [
  "id",
  "event_id",
  "trace_root_id",
  "session_id",
  "session_key",
  "agent_id",
  "agent_name",
  "chat_title",
  "run_id",
  "msg_id",
  "channel",
  "type",
  "schema_version",
  "client_ts",
  "created_at",
  "payload_json",
  "payload_json_length",
];

/** API query param names (excluding limit/offset for “at least one filter”). */
const FILTER_PARAM_NAMES = [
  "event_id",
  "trace_root_id",
  "session_id",
  "session_key",
  "session_key_prefix",
  "run_id",
  "msg_id",
  "channel",
  "type",
  "agent_id",
  "chat_title",
  "payload_contains",
  "client_ts_from",
  "client_ts_to",
  "id_min",
  "id_max",
] as const;

type FilterParamName = (typeof FILTER_PARAM_NAMES)[number];

type DevDbFieldLabelKey =
  | "fEventId"
  | "fTraceRoot"
  | "fSessionId"
  | "fSessionKey"
  | "fSessionKeyPrefix"
  | "fRunId"
  | "fMsgId"
  | "fChannel"
  | "fType"
  | "fAgentId"
  | "fChatTitle"
  | "fPayloadContains"
  | "fClientTsFrom"
  | "fClientTsTo"
  | "fIdMin"
  | "fIdMax";

const FILTER_FIELDS: ReadonlyArray<{ param: FilterParamName; labelKey: DevDbFieldLabelKey }> = [
  { param: "event_id", labelKey: "fEventId" },
  { param: "trace_root_id", labelKey: "fTraceRoot" },
  { param: "session_id", labelKey: "fSessionId" },
  { param: "session_key", labelKey: "fSessionKey" },
  { param: "session_key_prefix", labelKey: "fSessionKeyPrefix" },
  { param: "run_id", labelKey: "fRunId" },
  { param: "msg_id", labelKey: "fMsgId" },
  { param: "channel", labelKey: "fChannel" },
  { param: "type", labelKey: "fType" },
  { param: "agent_id", labelKey: "fAgentId" },
  { param: "chat_title", labelKey: "fChatTitle" },
  { param: "payload_contains", labelKey: "fPayloadContains" },
  { param: "client_ts_from", labelKey: "fClientTsFrom" },
  { param: "client_ts_to", labelKey: "fClientTsTo" },
  { param: "id_min", labelKey: "fIdMin" },
  { param: "id_max", labelKey: "fIdMax" },
];

function emptyFilterRecord(): Record<FilterParamName, string> {
  return Object.fromEntries(FILTER_PARAM_NAMES.map((k) => [k, ""])) as Record<FilterParamName, string>;
}

function orderedKeys(row: QueryRow): string[] {
  const keys = new Set(Object.keys(row));
  const ordered = EVENTS_COL_ORDER.filter((k: string) => keys.has(k));
  const rest = [...keys].filter((k) => !ordered.includes(k)).sort();
  return [...ordered, ...rest];
}

function str(v: unknown): string {
  if (v === null || v === undefined) {
    return "";
  }
  return String(v);
}

function rawDisplay(v: unknown): string {
  if (v === null || v === undefined) {
    return "";
  }
  if (typeof v === "string") {
    return v;
  }
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
    return String(v);
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function rowListKey(row: QueryRow): string {
  const eid = str(row.event_id);
  if (eid) {
    return eid;
  }
  const id = str(row.id);
  return id ? `id-${id}` : "row";
}

type QueryResult = {
  items: QueryRow[];
  total: number;
  limit: number;
  offset: number;
};

function FilterTextField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="block">
      <label htmlFor={id} className="mb-0.5 block text-[11px] font-medium text-ca-muted">
        {label}
      </label>
      <input
        id={id}
        name={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-ca-border px-2 py-1.5 font-mono text-xs text-neutral-900"
        spellCheck={false}
        autoComplete="off"
      />
    </div>
  );
}

function QueryResultTable({
  columnKeys,
  items,
  t,
}: {
  columnKeys: string[];
  items: QueryRow[];
  t: ReturnType<typeof useTranslations<"DevDb">>;
}) {
  return (
    <div className="mt-2 overflow-x-auto rounded-xl border border-ca-border bg-white">
      <table className="w-max min-w-full border-collapse text-left text-xs">
        <caption className="sr-only">{t("tableCaption")}</caption>
        <thead>
          <tr className="border-b border-ca-border bg-neutral-50 text-[10px] uppercase tracking-wide text-ca-muted">
            {columnKeys.map((col) => (
              <th
                key={col}
                scope="col"
                className="whitespace-nowrap border-r border-ca-border/50 px-2 py-2 text-left font-semibold last:border-r-0"
              >
                {col}
              </th>
            ))}
            <th
              scope="col"
              className="sticky right-0 z-[1] whitespace-nowrap border-l border-ca-border bg-neutral-100 px-2 py-2 font-semibold shadow-sm"
            >
              {t("colActions")}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => {
            const tk = computeThreadKey({
              session_key: str(row.session_key),
              session_id: str(row.session_id),
              trace_root_id: str(row.trace_root_id),
            });
            const rk = rowListKey(row);
            return (
              <tr key={rk} className="border-b border-ca-border/70 align-top">
                {columnKeys.map((col) => (
                  <td
                    key={`${rk}-${col}`}
                    className="max-w-[min(28rem,40vw)] border-r border-ca-border/40 px-2 py-2 align-top font-mono text-[10px] last:border-r-0"
                  >
                    {col === "payload_json" ? (
                      <pre className="ca-code-block m-0 max-h-64 min-w-[12rem] overflow-auto whitespace-pre-wrap break-all text-[10px] leading-snug">
                        {rawDisplay(row[col])}
                      </pre>
                    ) : (
                      <span
                        className="block max-h-32 overflow-auto whitespace-pre-wrap break-all"
                        title={rawDisplay(row[col])}
                      >
                        {rawDisplay(row[col])}
                      </span>
                    )}
                  </td>
                ))}
                <td className="sticky right-0 z-[1] border-l border-ca-border bg-white/95 px-2 py-2 shadow-sm backdrop-blur-sm">
                  {tk ? (
                    <LocalizedLink
                      href={`/traces/${encodeURIComponent(tk)}`}
                      className="text-ca-accent no-underline hover:underline"
                    >
                      {t("openTrace")}
                    </LocalizedLink>
                  ) : (
                    <span className="text-ca-muted">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function DevDbQueryPage() {
  const t = useTranslations("DevDb");
  const formId = useId();
  const idPrefix = `${formId}-f`;

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [filters, setFilters] = useState<Record<FilterParamName, string>>(emptyFilterRecord);
  const [limit, setLimit] = useState("100");
  const [offset, setOffset] = useState("0");
  const [omitPayloadBody, setOmitPayloadBody] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);

  const refreshConnection = useCallback(() => {
    setBaseUrl(loadCollectorUrl());
    setApiKey(loadApiKey());
  }, []);

  useEffect(() => {
    refreshConnection();
  }, [refreshConnection]);

  useEffect(() => {
    const onSettings = () => refreshConnection();
    window.addEventListener(CRABAGENT_COLLECTOR_SETTINGS_EVENT, onSettings);
    return () => window.removeEventListener(CRABAGENT_COLLECTOR_SETTINGS_EVENT, onSettings);
  }, [refreshConnection]);

  const hasNonEmptyFilter = useMemo(
    () => FILTER_PARAM_NAMES.some((k) => filters[k].trim().length > 0),
    [filters],
  );

  const columnKeys = useMemo(() => {
    if (!result?.items.length) {
      return [] as string[];
    }
    return orderedKeys(result.items[0] as QueryRow);
  }, [result]);

  const runQuery = useCallback(async () => {
    setError(null);
    setResult(null);
    const b = baseUrl.trim();
    if (!b) {
      setError(t("needCollector"));
      return;
    }
    if (!hasNonEmptyFilter) {
      setError(t("needFilter"));
      return;
    }
    setLoading(true);
    try {
      const finalParams = new URLSearchParams();
      for (const k of FILTER_PARAM_NAMES) {
        const v = filters[k].trim();
        if (v) {
          finalParams.set(k, v);
        }
      }
      finalParams.set("limit", limit.trim() || "100");
      finalParams.set("offset", offset.trim() || "0");
      if (omitPayloadBody) {
        finalParams.set("omit_payload", "1");
      }
      const res = await fetch(
        `${b.replace(/\/+$/, "")}/v1/dev/events/query?${finalParams.toString()}`,
        { headers: collectorAuthHeaders(apiKey) },
      );
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        const hint = data.hint != null ? ` ${String(data.hint)}` : "";
        setError(`${String(data.error ?? res.status)}${hint}`.trim());
        return;
      }
      setResult({
        items: (data.items as QueryRow[]) ?? [],
        total: Number(data.total ?? 0),
        limit: Number(data.limit ?? 0),
        offset: Number(data.offset ?? 0),
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [apiKey, baseUrl, filters, hasNonEmptyFilter, limit, offset, omitPayloadBody, t]);

  const resetForm = useCallback(() => {
    setFilters(emptyFilterRecord());
    setLimit("100");
    setOffset("0");
    setOmitPayloadBody(false);
    setResult(null);
    setError(null);
  }, []);

  const limitInputId = `${idPrefix}-limit`;
  const offsetInputId = `${idPrefix}-offset`;
  const omitPayloadId = `${idPrefix}-omit-payload`;

  return (
    <div className="mx-auto max-w-[min(100%,120rem)] px-4 py-8">
      <h1 className="text-xl font-semibold text-neutral-900">{t("title")}</h1>
      <p className="mt-1 text-sm text-ca-muted">{t("subtitle")}</p>

      <section
        className="mt-6 rounded-2xl border border-ca-border bg-white p-4 shadow-ca-sm"
        aria-busy={loading}
        aria-labelledby={`${formId}-heading`}
      >
        <h2 id={`${formId}-heading`} className="sr-only">
          {t("formSectionTitle")}
        </h2>
        <p className="mb-3 text-xs text-amber-900/90">{t("warning")}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FILTER_FIELDS.map(({ param, labelKey }) => (
            <FilterTextField
              key={param}
              id={`${idPrefix}-${param}`}
              label={t(labelKey)}
              value={filters[param]}
              onChange={(v) => setFilters((s) => ({ ...s, [param]: v }))}
            />
          ))}
          <FilterTextField id={limitInputId} label={t("fLimit")} value={limit} onChange={setLimit} />
          <FilterTextField id={offsetInputId} label={t("fOffset")} value={offset} onChange={setOffset} />
        </div>
        <div className="mt-3">
          <input
            id={omitPayloadId}
            name={omitPayloadId}
            type="checkbox"
            checked={omitPayloadBody}
            onChange={(e) => setOmitPayloadBody(e.target.checked)}
            className="rounded border-ca-border"
          />
          <label htmlFor={omitPayloadId} className="ml-2 cursor-pointer text-sm text-neutral-800">
            {t("omitPayload")}
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runQuery()}
            disabled={loading}
            className="ca-btn-primary rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? t("querying") : t("query")}
          </button>
          <button
            type="button"
            onClick={resetForm}
            className="rounded-xl border border-ca-border bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
          >
            {t("reset")}
          </button>
        </div>
        {error ? (
          <p className="mt-3 text-sm text-rose-700" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {result ? (
        <div className="mt-6">
          <p className="text-sm text-ca-muted">
            {t("resultSummary", {
              shown: String(result.items.length),
              total: String(result.total),
              limit: String(result.limit),
              offset: String(result.offset),
            })}
          </p>
          <p className="mt-1 text-xs text-ca-muted">{t("rawColumnsHint")}</p>
          {result.items.length === 0 ? (
            <p className="mt-2 rounded-xl border border-ca-border bg-white px-3 py-8 text-center text-ca-muted">{t("empty")}</p>
          ) : (
            <QueryResultTable columnKeys={columnKeys} items={result.items} t={t} />
          )}
        </div>
      ) : null}
    </div>
  );
}
