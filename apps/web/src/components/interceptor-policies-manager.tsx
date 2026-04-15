"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { TableProps } from "@arco-design/web-react";
import {
  Table,
  Button,
  Checkbox,
  Pagination,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  Message,
  Tag,
  Space,
  Popconfirm,
  Radio,
  Tooltip,
  Popover,
  Dropdown,
  Menu,
} from "@arco-design/web-react";
import { IconEdit, IconDelete, IconQuestionCircleFill, IconFilter } from "@arco-design/web-react/icon";
import { appendWorkspaceNameParam, loadApiKey, loadCollectorUrl, collectorAuthHeaders } from "@/lib/collector";
import { COLLECTOR_QUERY_SCOPE } from "@/lib/collector-api-paths";
import { ObserveTableHeaderLabel } from "@/components/observe-table-header-label";
import { ScrollableTableFrame } from "@/components/scrollable-table-frame";
import { TraceCopyIconButton } from "@/shared/components/trace-copy-icon-button";
import { OBSERVE_TABLE_FRAME_CLASSNAME, OBSERVE_TABLE_SCROLL_X } from "@/lib/observe-table-style";
import { OBSERVE_TABLE_ICON_BUTTON_CLASSNAME } from "@/lib/observe-table-control-style";
import {
  loadSecurityAuditEvents,
  loadSecurityAuditPolicyEventCounts,
  type SecurityAuditEventRow,
} from "@/lib/security-audit-records";
import { cn, formatShortId } from "@/lib/utils";
import { PAGE_SIZE_OPTIONS } from "@/lib/table-pagination";

import "@/lib/arco-react19-setup";

const Option = Select.Option;

/** 策略弹框「处置方式」选项与举例文案 key（对应 DataSecurity.*） */
const DISPOSITION_RADIO_OPTIONS = [
  { value: "data_mask", labelKey: "policyActionDataMask", exampleKey: "policyActionExampleDataMask" },
  { value: "abort_run", labelKey: "policyActionAbortRun", exampleKey: "policyActionExampleAbortRun" },
  { value: "input_guard", labelKey: "policyActionInputGuard", exampleKey: "policyActionExampleInputGuard" },
  { value: "audit_only", labelKey: "policyActionAuditOnly", exampleKey: "policyActionExampleAuditOnly" },
] as const;

function requiredLabel(label: ReactNode) {
  return (
    <span className="inline-flex items-center gap-1">
      <span>{label}</span>
      <span className="text-[rgb(var(--danger-6))]">*</span>
    </span>
  );
}

function PolicySingleFilterHeader({
  label,
  value,
  options,
  onChange,
  clearLabel,
}: {
  label: string;
  value: string;
  options: Array<{ text: string; value: string }>;
  onChange: (next: string) => void;
  clearLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const applied = value.trim().length > 0;
  return (
    <div className="flex items-center gap-1">
      <ObserveTableHeaderLabel>{label}</ObserveTableHeaderLabel>
      <Dropdown
        popupVisible={open}
        onVisibleChange={setOpen}
        trigger="click"
        droplist={
          <Menu
            selectedKeys={applied ? [value] : []}
            onClickMenuItem={(key) => {
              onChange(String(key));
              setOpen(false);
            }}
            className="min-w-[10rem]"
          >
            <Menu.Item key="__clear__" disabled={!applied}>
              <span
                className="text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange("");
                  setOpen(false);
                }}
              >
                {clearLabel}
              </span>
            </Menu.Item>
            {options.map((opt) => (
              <Menu.Item key={opt.value}>{opt.text}</Menu.Item>
            ))}
          </Menu>
        }
      >
        <Button
          type="text"
          size="mini"
          className={cn(
            OBSERVE_TABLE_ICON_BUTTON_CLASSNAME,
            applied ? "!text-primary hover:!text-primary" : "!text-neutral-600 hover:!text-neutral-700",
          )}
          aria-expanded={open}
        >
          <IconFilter className={cn("size-3.5", applied ? "text-primary" : "text-neutral-600")} strokeWidth={2} />
        </Button>
      </Dropdown>
    </div>
  );
}

function PolicyMultiFilterHeader({
  label,
  value,
  options,
  onChange,
  clearLabel,
}: {
  label: string;
  value: string[];
  options: Array<{ text: string; value: string }>;
  onChange: (next: string[]) => void;
  clearLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const applied = value.length > 0;
  const toggle = (v: string, checked: boolean) => {
    if (checked) {
      onChange([...new Set([...value, v])]);
      return;
    }
    onChange(value.filter((x) => x !== v));
  };
  return (
    <div className="flex items-center gap-1">
      <ObserveTableHeaderLabel>{label}</ObserveTableHeaderLabel>
      <Dropdown
        popupVisible={open}
        onVisibleChange={setOpen}
        trigger="click"
        position="bl"
        droplist={
          <div
            className="min-w-[11rem] rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-md"
            onMouseDown={(e) => e.preventDefault()}
          >
            <Button
              type="text"
              size="mini"
              className="mb-2 h-8 w-full justify-start px-2 text-xs font-normal"
              onClick={() => {
                onChange([]);
                setOpen(false);
              }}
              disabled={!applied}
            >
              {clearLabel}
            </Button>
            <div className="space-y-1 border-t border-border pt-2">
              {options.map((opt) => (
                <Checkbox
                  key={opt.value}
                  checked={value.includes(opt.value)}
                  onChange={(c) => toggle(opt.value, Boolean(c))}
                  className="!flex !w-full !items-center py-0.5 [&_.arco-checkbox-text]:text-xs"
                >
                  {opt.text}
                </Checkbox>
              ))}
            </div>
          </div>
        }
      >
        <Button
          type="text"
          size="mini"
          className={cn(
            OBSERVE_TABLE_ICON_BUTTON_CLASSNAME,
            applied ? "!text-primary hover:!text-primary" : "!text-neutral-600 hover:!text-neutral-700",
          )}
          aria-expanded={open}
        >
          <IconFilter className={cn("size-3.5", applied ? "text-primary" : "text-neutral-600")} strokeWidth={2} />
        </Button>
      </Dropdown>
    </div>
  );
}

interface InterceptionPolicy {
  id: string;
  name: string;
  description?: string;
  pattern: string;
  redact_type: "mask" | "hash" | "block";
  targets_json: string;
  enabled: number;
  severity?: string | null;
  policy_action?: string | null;
  detection_kind?: string | null;
  created_at_ms?: number | null;
  updated_at_ms: number;
  pulled_at_ms?: number | null;
}

export function InterceptorPoliciesManager({
  templatePolicy,
  onTemplatePolicyHandled,
  searchQuery = "",
  refreshSignal = 0,
}: {
  templatePolicy?: Partial<InterceptionPolicy> & { targets?: string[] } | null;
  onTemplatePolicyHandled?: () => void;
  searchQuery?: string;
  refreshSignal?: number;
}) {
  const t = useTranslations("DataSecurity");
  const queryClient = useQueryClient();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<Partial<InterceptionPolicy> | null>(null);
  const [form] = Form.useForm();
  /** 与「正则表达式」表单项显隐联动（模型检测上线后同逻辑） */
  const [detectionKind, setDetectionKind] = useState<"regex" | "model">("regex");
  /** 创建时间列排序：默认最新在前（与 Trace 列表时间倒序一致） */
  const [createdSortOrder, setCreatedSortOrder] = useState<"ascend" | "descend">("descend");
  const [severityFilters, setSeverityFilters] = useState<string[]>([]);
  const [actionFilters, setActionFilters] = useState<string[]>([]);
  const [targetsFilters, setTargetsFilters] = useState<string[]>([]);
  const [enabledFilters, setEnabledFilters] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [policyEventsPolicy, setPolicyEventsPolicy] = useState<InterceptionPolicy | null>(null);
  const [policyEventsPage, setPolicyEventsPage] = useState(1);
  const [policyEventsPageSize, setPolicyEventsPageSize] = useState(20);

  useEffect(() => {
    if (!isModalVisible) {
      return;
    }
    const dk = form.getFieldValue("detection_kind");
    setDetectionKind(dk === "model" ? "model" : "regex");
  }, [isModalVisible, editingPolicy?.id, form]);

  useEffect(() => {
    if (!templatePolicy) {
      return;
    }

    setEditingPolicy(null);
    const tp = templatePolicy as Partial<InterceptionPolicy> | undefined;
    form.setFieldsValue({
      name: templatePolicy.name ?? "",
      description: templatePolicy.description ?? "",
      pattern: templatePolicy.pattern ?? "",
      severity: tp?.severity ?? "high",
      policy_action: tp?.policy_action ?? "data_mask",
      detection_kind: "regex",
      targets: templatePolicy.targets ?? ["prompt", "assistantTexts"],
      enabled: templatePolicy.enabled !== 0,
    });
    setIsModalVisible(true);
    onTemplatePolicyHandled?.();
  }, [templatePolicy, form, onTemplatePolicyHandled]);

  const collectorUrl = loadCollectorUrl();
  const apiKey = loadApiKey();

  const { data: policies = [], isLoading, refetch } = useQuery({
    queryKey: ["interception-policies", collectorUrl, "workspace-scoped"],
    queryFn: async () => {
      const sp = new URLSearchParams();
      appendWorkspaceNameParam(sp);
      const url = `${collectorUrl.replace(/\/+$/, "")}/v1/policies?${sp.toString()}`;
      const headers: Record<string, string> = {
        Accept: "application/json",
        ...(collectorAuthHeaders(apiKey) as Record<string, string>),
      };
      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.error || `Failed to fetch policies (HTTP ${resp.status})`);
      }
      return resp.json() as Promise<InterceptionPolicy[]>;
    },
    enabled: !!collectorUrl,
  });

  const formatPolicyTime = (ms?: number | null) =>
    ms != null && Number.isFinite(ms) ? new Date(ms).toLocaleString() : "—";

  const parseTargets = useCallback((targetsJson: string): string[] => {
    try {
      const parsed = JSON.parse(targetsJson || "[]");
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x ?? "").trim()).filter(Boolean);
      }
      return [];
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refreshSignal, refetch]);

  const policyEventsQ = useQuery({
    queryKey: [
      COLLECTOR_QUERY_SCOPE.securityAuditEvents,
      collectorUrl,
      apiKey,
      "policy-events",
      policyEventsPolicy?.id ?? "",
      policyEventsPage,
      policyEventsPageSize,
    ],
    enabled: !!collectorUrl && !!policyEventsPolicy?.id,
    queryFn: () =>
      loadSecurityAuditEvents(collectorUrl, apiKey, {
        order: "desc",
        limit: policyEventsPageSize,
        offset: (policyEventsPage - 1) * policyEventsPageSize,
        policyId: policyEventsPolicy?.id ?? undefined,
      }),
    staleTime: 20_000,
  });
  const policyEventCountsQ = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.securityAuditPolicyEventCounts, collectorUrl, apiKey],
    enabled: !!collectorUrl,
    queryFn: () => loadSecurityAuditPolicyEventCounts(collectorUrl, apiKey),
    staleTime: 20_000,
  });
  const policyEventCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of policyEventCountsQ.data ?? []) {
      map.set(row.policy_id, row.event_count);
    }
    return map;
  }, [policyEventCountsQ.data]);

  const normalizedSearch = (searchQuery || "").trim().toLowerCase();
  const filteredPolicies = useMemo(() => {
    return policies.filter((policy) => {
      if (normalizedSearch) {
        const idLower = policy.id.toLowerCase();
        const searchIn = [policy.name, policy.description || "", policy.pattern, policy.targets_json]
          .join(" ")
          .toLowerCase();
        if (!idLower.includes(normalizedSearch) && !searchIn.includes(normalizedSearch)) {
          return false;
        }
      }

      const sev = (policy.severity ?? "high").toLowerCase();
      if (severityFilters.length > 0 && !severityFilters.includes(sev)) {
        return false;
      }

      const action = (policy.policy_action ?? "data_mask").toLowerCase();
      if (actionFilters.length > 0 && !actionFilters.includes(action)) {
        return false;
      }

      const targets = parseTargets(policy.targets_json);
      if (targetsFilters.length > 0 && !targets.some((target) => targetsFilters.includes(target))) {
        return false;
      }

      const enabledValue = policy.enabled === 1 ? "1" : "0";
      if (enabledFilters.length > 0 && !enabledFilters.includes(enabledValue)) {
        return false;
      }

      return true;
    });
  }, [policies, normalizedSearch, severityFilters, actionFilters, targetsFilters, enabledFilters, parseTargets]);

  const sortedPolicies = useMemo(() => {
    const arr = [...filteredPolicies];
    arr.sort((a, b) => {
      const ta = a.created_at_ms != null && Number.isFinite(a.created_at_ms) ? a.created_at_ms : 0;
      const tb = b.created_at_ms != null && Number.isFinite(b.created_at_ms) ? b.created_at_ms : 0;
      return createdSortOrder === "descend" ? tb - ta : ta - tb;
    });
    return arr;
  }, [filteredPolicies, createdSortOrder]);

  const pagedPolicies = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedPolicies.slice(start, start + pageSize);
  }, [sortedPolicies, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [normalizedSearch, severityFilters, actionFilters, targetsFilters, enabledFilters, createdSortOrder, pageSize]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(sortedPolicies.length / pageSize));
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [sortedPolicies.length, pageSize, page]);

  const onTableChange = useCallback<NonNullable<TableProps<InterceptionPolicy>["onChange"]>>(
    (_pagination, sorter, _filters, extra) => {
      if (extra.action !== "sort") {
        return;
      }
      const s = Array.isArray(sorter) ? sorter[0] : sorter;
      if (String(s?.field) !== "created_at_ms") {
        return;
      }
      if (s.direction === "ascend") {
        setCreatedSortOrder("ascend");
        return;
      }
      if (s.direction === "descend") {
        setCreatedSortOrder("descend");
        return;
      }
      setCreatedSortOrder((prev) => (prev === "descend" ? "ascend" : "descend"));
    },
    [],
  );

  const upsertMutation = useMutation({
    mutationFn: async (policy: Partial<InterceptionPolicy>) => {
      const sp = new URLSearchParams();
      appendWorkspaceNameParam(sp);
      const url = `${collectorUrl.replace(/\/+$/, "")}/v1/policies?${sp.toString()}`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(collectorAuthHeaders(apiKey) as Record<string, string>),
      };
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(policy),
      });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.error || `Failed to save policy (HTTP ${resp.status})`);
      }
      return resp.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["interception-policies"] });
      Message.success(t("saveOk"));
      setIsModalVisible(false);
      form.resetFields();
    },
    onError: (err) => {
      Message.error(String(err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const sp = new URLSearchParams();
      appendWorkspaceNameParam(sp);
      const url = `${collectorUrl.replace(/\/+$/, "")}/v1/policies/${id}?${sp.toString()}`;
      const headers: Record<string, string> = {
        Accept: "application/json",
        ...(collectorAuthHeaders(apiKey) as Record<string, string>),
      };
      const resp = await fetch(url, { method: "DELETE", headers });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.error || `Failed to delete policy (HTTP ${resp.status})`);
      }
      return resp.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["interception-policies"] });
      Message.success(t("deleteOk"));
    },
    onError: (err) => {
      Message.error(String(err));
    },
  });

  const handleEdit = useCallback(
    (policy: InterceptionPolicy) => {
      setEditingPolicy(policy);
      form.setFieldsValue({
        ...policy,
        enabled: policy.enabled === 1,
        targets: JSON.parse(policy.targets_json || "[]"),
        severity: policy.severity ?? "high",
        policy_action: policy.policy_action ?? "data_mask",
        detection_kind: policy.detection_kind === "model" ? "model" : (policy.detection_kind ?? "regex"),
      });
      setIsModalVisible(true);
    },
    [form],
  );

  const handleToggleEnabled = useCallback(
    (policy: InterceptionPolicy) => {
      upsertMutation.mutate({
        ...policy,
        enabled: policy.enabled === 1 ? 0 : 1,
        targets_json: policy.targets_json,
      });
    },
    [upsertMutation],
  );

  const handleSubmit = async () => {
    try {
      const values = await form.validate();
      const v = values as {
        name?: string;
        description?: string;
        pattern?: string;
        detection_kind?: string;
        severity?: string;
        policy_action?: string;
        targets?: string[];
        enabled?: boolean;
      };
      const dk = v.detection_kind === "model" ? "model" : "regex";
      const payload: Partial<InterceptionPolicy> = {
        id: editingPolicy?.id,
        name: v.name,
        description: v.description,
        pattern: dk === "regex" ? String(v.pattern ?? "").trim() : "",
        severity: v.severity,
        policy_action: v.policy_action,
        enabled: v.enabled ? 1 : 0,
        targets_json: JSON.stringify(v.targets || []),
        detection_kind: dk,
      };
      upsertMutation.mutate(payload);
    } catch {
      // Validation error
    }
  };

  const handleCloseModal = useCallback(() => {
    setIsModalVisible(false);
    setEditingPolicy(null);
    form.resetFields();
    setDetectionKind("regex");
  }, [form]);

  const columns = useMemo(
    () => [
      {
        title: (
          <PolicySingleFilterHeader
            label={t("policyId")}
            value={severityFilters[0] ?? ""}
            onChange={(next) => setSeverityFilters(next ? [next] : [])}
            clearLabel={t("clearFilters")}
            options={[
              { text: t("policySeverityLow"), value: "low" },
              { text: t("policySeverityHigh"), value: "high" },
              { text: t("policySeverityCritical"), value: "critical" },
            ]}
          />
        ),
        dataIndex: "id",
        key: "id",
        width: 220,
        fixed: "left" as const,
        render: (id: string, record: InterceptionPolicy) => {
          const s = (record.severity ?? "high").toLowerCase();
          const color = s === "critical" ? "red" : s === "low" ? "green" : "orange";
          const label =
            s === "low" ? t("policySeverityLow") : s === "critical" ? t("policySeverityCritical") : t("policySeverityHigh");
          return (
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1">
                <span className="block min-w-0 truncate font-mono text-xs text-neutral-800 dark:text-neutral-100" title={id}>
                  {formatShortId(id)}
                </span>
                <TraceCopyIconButton
                  text={id}
                  ariaLabel={t("copyPolicyIdAria")}
                  tooltipLabel={t("copyTooltip")}
                  successLabel={t("copySuccess")}
                  className="p-1 hover:bg-neutral-100 dark:hover:bg-zinc-800"
                  stopPropagation
                />
              </div>
              <div className="mt-1">
                <Tag color={color} className="!rounded-md text-xs">
                  {label}
                </Tag>
              </div>
            </div>
          );
        },
      },
      {
        title: <ObserveTableHeaderLabel>{t("policyEvents")}</ObserveTableHeaderLabel>,
        dataIndex: "id",
        key: "policy_events",
        width: 96,
        render: (id: string, record: InterceptionPolicy) => {
          const count = policyEventCountMap.get(id) ?? 0;
          return (
            <Button
              type="text"
              size="mini"
              className="!h-auto !px-0 text-xs font-medium tabular-nums"
              onClick={() => {
                setPolicyEventsPolicy(record);
                setPolicyEventsPage(1);
              }}
            >
              {count}
            </Button>
          );
        },
      },
      {
        title: <ObserveTableHeaderLabel>{t("policyPulledAt")}</ObserveTableHeaderLabel>,
        dataIndex: "pulled_at_ms",
        key: "pulled_at_ms",
        width: 168,
        render: (pulled_at_ms?: number | null) => (
          <span className="text-xs tabular-nums text-neutral-800 dark:text-neutral-100">
            {pulled_at_ms != null && Number.isFinite(pulled_at_ms) ? formatPolicyTime(pulled_at_ms) : "—"}
          </span>
        ),
      },
      {
        title: <ObserveTableHeaderLabel>{t("policyName")}</ObserveTableHeaderLabel>,
        dataIndex: "name",
        key: "name",
        width: 260,
        render: (name: string, record: InterceptionPolicy) => (
          <Space direction="vertical" size={0}>
            <span className="text-xs text-neutral-800 dark:text-neutral-100">{name}</span>
            {record.description ? (
              <Popover
                trigger="hover"
                position="top"
                content={
                  <div className="max-w-[28rem] whitespace-pre-wrap break-words text-xs leading-relaxed text-neutral-700 dark:text-neutral-200">
                    {record.description}
                  </div>
                }
              >
                <span className="block max-w-[14rem] truncate text-xs text-neutral-500 dark:text-neutral-400">
                  {record.description}
                </span>
              </Popover>
            ) : (
              <span className="text-xs text-neutral-500 dark:text-neutral-400">—</span>
            )}
          </Space>
        ),
      },
      {
        title: <ObserveTableHeaderLabel>{t("detectionKind")}</ObserveTableHeaderLabel>,
        dataIndex: "pattern",
        key: "detection_display",
        width: 150,
        render: (_pattern: string, record: InterceptionPolicy) => {
          const dk = (record.detection_kind ?? "regex").toLowerCase();
          if (dk === "model") {
            return <span className="text-xs text-neutral-600 dark:text-zinc-400">{t("detectionModelSoon")}</span>;
          }
          const pat = record.pattern || "";
          return (
            <Popover
              trigger="hover"
              position="top"
              content={
                <div className="max-w-[min(36rem,calc(100vw-2rem))] rounded-xl bg-background p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-xs font-medium text-neutral-500 dark:text-zinc-400">
                      {t("policyPattern")}
                    </div>
                    {pat ? (
                      <TraceCopyIconButton
                        text={pat}
                        ariaLabel={t("copyPolicyPatternAria")}
                        tooltipLabel={t("copyTooltip")}
                        successLabel={t("copySuccess")}
                        className="p-1 hover:bg-neutral-100 dark:hover:bg-zinc-800"
                        stopPropagation
                      />
                    ) : null}
                  </div>
                  <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all font-mono text-xs leading-5 text-neutral-800 dark:text-zinc-100">
                    {pat || "—"}
                  </div>
                </div>
              }
            >
              <span className="inline-flex cursor-help items-center rounded-md bg-neutral-200/70 px-2 py-1 text-xs text-neutral-700 dark:bg-zinc-700/60 dark:text-zinc-200">
                {t("detectionRegex")}
              </span>
            </Popover>
          );
        },
      },
      {
        title: (
          <PolicySingleFilterHeader
            label={t("policyAction")}
            value={actionFilters[0] ?? ""}
            onChange={(next) => setActionFilters(next ? [next] : [])}
            clearLabel={t("clearFilters")}
            options={[
              { text: t("policyActionDataMask"), value: "data_mask" },
              { text: t("policyActionAbortRun"), value: "abort_run" },
              { text: t("policyActionInputGuard"), value: "input_guard" },
              { text: t("policyActionAuditOnly"), value: "audit_only" },
            ]}
          />
        ),
        dataIndex: "policy_action",
        key: "policy_action",
        width: 120,
        render: (action: string | null | undefined) => {
          const a = action ?? "data_mask";
          const labelKey =
            a === "abort_run"
              ? "policyActionAbortRun"
              : a === "input_guard"
                ? "policyActionInputGuard"
                : a === "audit_only"
                  ? "policyActionAuditOnly"
                  : "policyActionDataMask";
          return (
            <span
              className="block max-w-[10rem] truncate text-xs text-neutral-800 dark:text-neutral-200"
              title={t(labelKey)}
            >
              {t(labelKey)}
            </span>
          );
        },
      },
      {
        title: <ObserveTableHeaderLabel>{t("policyCreatedAt")}</ObserveTableHeaderLabel>,
        dataIndex: "created_at_ms",
        key: "created_at_ms",
        width: 168,
        sorter: (a: InterceptionPolicy, b: InterceptionPolicy) =>
          (a.created_at_ms ?? 0) - (b.created_at_ms ?? 0),
        sortOrder: createdSortOrder,
        sortDirections: ["descend", "ascend"] as ("ascend" | "descend")[],
        render: (created_at_ms?: number | null) => (
          <span className="text-xs tabular-nums text-neutral-800 dark:text-neutral-100">{formatPolicyTime(created_at_ms)}</span>
        ),
      },
      {
        title: <ObserveTableHeaderLabel>{t("policyUpdatedAt")}</ObserveTableHeaderLabel>,
        dataIndex: "updated_at_ms",
        key: "updated_at_ms",
        width: 168,
        render: (updated_at_ms: number) => (
          <span className="text-xs tabular-nums text-neutral-800 dark:text-neutral-100">{formatPolicyTime(updated_at_ms)}</span>
        ),
      },
      {
        title: (
          <PolicyMultiFilterHeader
            label={t("policyTargets")}
            value={targetsFilters}
            onChange={setTargetsFilters}
            clearLabel={t("clearFilters")}
            options={[
              { text: "prompt", value: "prompt" },
              { text: "assistantTexts", value: "assistantTexts" },
              { text: "tool_params", value: "tool_params" },
              { text: "tool_output", value: "tool_output" },
              { text: "metadata", value: "metadata" },
            ]}
          />
        ),
        dataIndex: "targets_json",
        key: "targets_json",
        width: 180,
        render: (targetsJson: string) => {
          const targets = parseTargets(targetsJson);
          if (targets.length === 0) {
            return <span className="text-xs text-neutral-500 dark:text-neutral-400">—</span>;
          }
          const preview = targets.join(", ");
          return (
            <Popover
              trigger="hover"
              position="top"
              content={
                <div className="max-w-[24rem] whitespace-pre-wrap break-words text-xs leading-relaxed text-neutral-700 dark:text-neutral-200">
                  {preview}
                </div>
              }
            >
              <span className="block max-w-[10rem] truncate text-xs text-neutral-800 dark:text-neutral-200" title={preview}>
                {preview}
              </span>
            </Popover>
          );
        },
      },
      {
        title: (
          <PolicySingleFilterHeader
            label={t("policyEnabled")}
            value={enabledFilters[0] ?? ""}
            onChange={(next) => setEnabledFilters(next ? [next] : [])}
            clearLabel={t("clearFilters")}
            options={[
              { text: t("filterStatusEnabled"), value: "1" },
              { text: t("filterStatusDisabled"), value: "0" },
            ]}
          />
        ),
        dataIndex: "enabled",
        key: "enabled",
        render: (enabled: number, record: InterceptionPolicy) => (
          <Switch checked={enabled === 1} onChange={() => handleToggleEnabled(record)} size="small" />
        ),
      },
      {
        title: <ObserveTableHeaderLabel>{t("tableActions")}</ObserveTableHeaderLabel>,
        key: "actions",
        fixed: "right" as const,
        width: 120,
        render: (_: unknown, record: InterceptionPolicy) => (
          <Space>
            <Tooltip content={t("editPolicy")}>
              <Button
                type="text"
                size="small"
                icon={<IconEdit />}
                className="!text-neutral-900 hover:!bg-neutral-200/70 hover:!text-neutral-700 dark:!text-zinc-100 dark:hover:!bg-zinc-700/70 dark:hover:!text-zinc-300"
                onClick={() => handleEdit(record)}
              />
            </Tooltip>
            <Tooltip content={t("deletePolicyTooltip")}>
              <span className="inline-flex">
                <Popconfirm title={t("deletePolicyConfirm")} onOk={() => deleteMutation.mutate(record.id)}>
                  <Button
                    type="text"
                    size="small"
                    icon={<IconDelete />}
                    className="!text-neutral-900 hover:!bg-neutral-200/70 hover:!text-neutral-700 dark:!text-zinc-100 dark:hover:!bg-zinc-700/70 dark:hover:!text-zinc-300"
                  />
                </Popconfirm>
              </span>
            </Tooltip>
          </Space>
        ),
      },
    ],
    [
      t,
      createdSortOrder,
      handleEdit,
      handleToggleEnabled,
      deleteMutation,
      severityFilters,
      actionFilters,
      targetsFilters,
      enabledFilters,
      parseTargets,
      policyEventCountMap,
    ],
  );

  return (
    <div>
      <div className={OBSERVE_TABLE_FRAME_CLASSNAME}>
        <ScrollableTableFrame
          variant="neutral"
          contentKey={`${sortedPolicies.length}:${isLoading ? 1 : 0}`}
          scrollClassName="overflow-x-visible touch-pan-x overscroll-x-contain"
        >
          <div className="min-w-0 w-full">
            <Table<InterceptionPolicy>
              tableLayoutFixed
              size="small"
              border={{ wrapper: false, cell: false, headerCell: false, bodyCell: false }}
              columns={columns}
              data={pagedPolicies}
              rowKey="id"
              pagination={false}
              scroll={OBSERVE_TABLE_SCROLL_X}
              hover
              loading={isLoading}
              onChange={onTableChange}
              noDataElement={<div className="flex justify-center px-4 py-10 text-xs text-neutral-500">{t("noPolicies")}</div>}
            />
            {sortedPolicies.length > 0 ? (
              <div className="flex flex-col items-center gap-2 border-t-0 pt-4 sm:flex-row sm:justify-between">
                <span className="text-xs text-muted-foreground">
                  {t("showingOfTotal", {
                    from: String((page - 1) * pageSize + 1),
                    to: String(Math.min(page * pageSize, sortedPolicies.length)),
                    total: String(sortedPolicies.length),
                  })}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium tabular-nums text-muted-foreground">
                    {t("paginationTotalPages", {
                      count: String(Math.max(1, Math.ceil(sortedPolicies.length / pageSize))),
                    })}
                  </span>
                  <Pagination
                    className="resource-audit-audit-log-pagination mx-0"
                    size="small"
                    current={page}
                    pageSize={pageSize}
                    total={sortedPolicies.length}
                    showTotal
                    onChange={(nextPage, nextPageSize) => {
                      if (nextPageSize && nextPageSize !== pageSize) {
                        setPageSize(nextPageSize);
                      }
                      setPage(nextPage);
                    }}
                    bufferSize={1}
                    sizeCanChange
                    sizeOptions={[...PAGE_SIZE_OPTIONS]}
                    showJumper
                    disabled={isLoading}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </ScrollableTableFrame>
      </div>

      <Modal
        title={editingPolicy ? t("editPolicy") : t("addPolicy")}
        visible={isModalVisible}
        onOk={handleSubmit}
        confirmLoading={upsertMutation.isPending}
        onCancel={handleCloseModal}
        className="policy-edit-modal"
        style={{ width: 760, maxWidth: "calc(100vw - 2rem)" }}
        maskClosable={false}
      >
        <div className="policy-modal-scroll max-h-[min(72vh,640px)] overflow-y-auto overflow-x-hidden pr-3 [-webkit-overflow-scrolling:touch]">
          <Form
            form={form}
            layout="vertical"
            className="policy-modal-form"
            requiredSymbol={false}
            onValuesChange={(changed, all) => {
              const next = (all as { detection_kind?: string }).detection_kind;
              const resolved = next === "model" ? "model" : "regex";
              setDetectionKind(resolved);
              if (Object.prototype.hasOwnProperty.call(changed, "detection_kind") && changed.detection_kind === "model") {
                form.setFieldValue("pattern", "");
              }
            }}
          >
            <Form.Item
              label={requiredLabel(t("policyName"))}
              field="name"
              rules={[{ required: true }]}
              className="policy-modal-field-full policy-modal-name-field"
            >
              <Input placeholder="例如：拦截手机号" />
            </Form.Item>
            <Form.Item label={t("policyDescription")} field="description" className="policy-modal-field-full policy-modal-desc-field">
              <Input.TextArea placeholder="可选描述" autoSize={{ minRows: 2, maxRows: 6 }} />
            </Form.Item>

              <Form.Item
                label={t("detectionKind")}
                field="detection_kind"
                initialValue="regex"
                className="policy-modal-detection-row !mb-0"
              >
                <Radio.Group className="custom-radio-card-group custom-radio-card-group--horizontal custom-radio-card-group--detection-pair">
                  <Radio value="regex">{t("detectionRegex")}</Radio>
                  <Radio value="model" disabled>
                    {t("detectionModelSoon")}
                  </Radio>
                </Radio.Group>
              </Form.Item>

            {detectionKind === "regex" ? (
              <Form.Item
                label={requiredLabel(
                  <span className="inline-flex items-center gap-1.5">
                    <span>{t("policyPattern")}</span>
                    <Tooltip
                      content={
                        <div className="max-w-[min(24rem,calc(100vw-2rem))] whitespace-pre-line text-left text-xs leading-relaxed">
                          {t("policyPatternFormatTooltip")}
                        </div>
                      }
                    >
                      <span className="inline-flex cursor-help items-center text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300">
                        <IconQuestionCircleFill className="text-[13px]" />
                      </span>
                    </Tooltip>
                  </span>,
                )}
                field="pattern"
                rules={[
                  { required: true, message: t("policyPatternRequired") },
                  {
                    validator(value, callback) {
                      const raw = String(value ?? "").trim();
                      if (!raw) {
                        callback();
                        return;
                      }
                      if (/^\/.+\/[a-z]*$/i.test(raw)) {
                        callback(t("policyPatternWrappedLiteralNotAllowed"));
                        return;
                      }
                      try {
                        new RegExp(raw, "g");
                        callback();
                      } catch {
                        callback(t("policyPatternInvalid"));
                      }
                    },
                  },
                ]}
                className="policy-modal-field-full policy-modal-pattern-field"
              >
                <Input placeholder="RegExp pattern" />
              </Form.Item>
            ) : (
              <div className="mb-4 rounded-[var(--radius)] border border-dashed border-border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                {t("detectionModelNoPatternHint")}
              </div>
            )}

            <Form.Item
              label={t("policyDisposition")}
              field="policy_action"
              initialValue="data_mask"
              className="policy-modal-disposition-inline"
            >
              <Radio.Group className="custom-radio-card-group custom-radio-card-group--grid">
                {DISPOSITION_RADIO_OPTIONS.map((opt) => (
                  <Radio key={opt.value} value={opt.value}>
                    <span className="w-full min-w-0">
                      <span className="font-medium text-neutral-800 dark:text-neutral-100">{t(opt.labelKey)}</span>
                      <span className="mt-0.5 block text-xs font-normal leading-snug text-neutral-500 dark:text-neutral-400">
                        {t(opt.exampleKey)}
                      </span>
                    </span>
                  </Radio>
                ))}
              </Radio.Group>
            </Form.Item>

            <Form.Item
              label={
                <span className="inline-flex items-center gap-1.5">
                  <span>{t("policyTargets")}</span>
                  <Tooltip content="指定哪些字段需要进行脱敏处理">
                    <span className="inline-flex cursor-help items-center text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300">
                      <IconQuestionCircleFill className="text-[13px]" />
                    </span>
                  </Tooltip>
                </span>
              }
              field="targets"
              initialValue={["prompt", "assistantTexts"]}
              className="policy-modal-targets-field"
            >
              <Select mode="multiple" placeholder="选择字段">
                <Option value="prompt">用户 Prompt</Option>
                <Option value="assistantTexts">模型输出 (Assistant)</Option>
                <Option value="tool_params">工具调用参数</Option>
                <Option value="tool_output">{t("policyTargetToolOutput")}</Option>
                <Option value="metadata">元数据 (Metadata)</Option>
              </Select>
            </Form.Item>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-5">
              <Form.Item label={t("policySeverity")} field="severity" initialValue="high" className="!mb-0">
                <Select>
                  <Option value="low">{t("policySeverityLow")}</Option>
                  <Option value="high">{t("policySeverityHigh")}</Option>
                  <Option value="critical">{t("policySeverityCritical")}</Option>
                </Select>
              </Form.Item>
              <Form.Item
                label={t("policyEnabled")}
                field="enabled"
                triggerPropName="checked"
                initialValue={true}
                className="policy-modal-enabled-row !mb-0"
              >
                <Switch />
              </Form.Item>
            </div>
          </Form>
        </div>
      </Modal>

      <Modal
        title={t("policyEventsTitle", { name: policyEventsPolicy?.name ?? "—" })}
        visible={policyEventsPolicy != null}
        onCancel={() => setPolicyEventsPolicy(null)}
        footer={null}
        style={{ width: 920, maxWidth: "calc(100vw - 2rem)" }}
      >
        <Table<SecurityAuditEventRow>
          size="small"
          loading={policyEventsQ.isLoading}
          rowKey="id"
          pagination={false}
          scroll={{ y: 420 }}
          data={policyEventsQ.data?.items ?? []}
          columns={[
            {
              title: t("policyEventsColTime"),
              dataIndex: "created_at_ms",
              width: 168,
              render: (ms: number) => (
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  {ms > 0 ? formatPolicyTime(ms) : "—"}
                </span>
              ),
            },
            {
              title: t("policyEventsColTrace"),
              dataIndex: "trace_id",
              width: 140,
              render: (traceId: string) => (
                <Space size={4} align="center">
                  <span className="font-mono text-xs text-primary">{formatShortId(traceId)}</span>
                  {traceId ? (
                    <TraceCopyIconButton
                      text={traceId}
                      ariaLabel={t("copyTraceIdAria")}
                      tooltipLabel={t("copyTooltip")}
                      successLabel={t("copySuccess")}
                      className="p-1 hover:bg-neutral-100 dark:hover:bg-zinc-800"
                      stopPropagation
                    />
                  ) : null}
                </Space>
              ),
            },
            {
              title: t("policyEventsColSpan"),
              dataIndex: "span_id",
              width: 120,
              render: (spanId: string | null) => (
                spanId ? (
                  <Space size={4} align="center">
                    <span className="font-mono text-xs text-muted-foreground">{formatShortId(spanId)}</span>
                    <TraceCopyIconButton
                      text={spanId}
                      ariaLabel={t("copySpanIdAria")}
                      tooltipLabel={t("copyTooltip")}
                      successLabel={t("copySuccess")}
                      className="p-1 hover:bg-neutral-100 dark:hover:bg-zinc-800"
                      stopPropagation
                    />
                  </Space>
                ) : (
                  <span className="font-mono text-xs text-muted-foreground">—</span>
                )
              ),
            },
            {
              title: t("policyEventsColHits"),
              dataIndex: "hit_count",
              width: 88,
              render: (n: number) => <span className="text-xs tabular-nums">{n}</span>,
            },
            {
              title: t("policyEventsColMode"),
              dataIndex: "intercepted",
              width: 108,
              render: (n: number) => (
                <Tag size="small" color={n === 1 ? "orange" : "gray"}>
                  {n === 1 ? t("policyEventsModeEnforced") : t("policyEventsModeObserve")}
                </Tag>
              ),
            },
            {
              title: t("policyEventsColWorkspace"),
              dataIndex: "workspace_name",
              render: (_: string, row) => (
                <span className="text-xs text-neutral-700 dark:text-neutral-300">
                  {[row.workspace_name, row.project_name].filter(Boolean).join(" · ") || "—"}
                </span>
              ),
            },
          ]}
          noDataElement={<div className="py-10 text-center text-xs text-muted-foreground">{t("policyEventsEmpty")}</div>}
        />
        {(policyEventsQ.data?.total ?? 0) > 0 ? (
          <div className="mt-3 flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
            <span className="text-xs text-muted-foreground">
              {t("showingOfTotal", {
                from: String((policyEventsPage - 1) * policyEventsPageSize + 1),
                to: String(
                  Math.min(
                    policyEventsPage * policyEventsPageSize,
                    policyEventsQ.data?.total ?? 0,
                  ),
                ),
                total: String(policyEventsQ.data?.total ?? 0),
              })}
            </span>
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium tabular-nums text-muted-foreground">
                {t("paginationTotalPages", {
                  count: String(
                    Math.max(
                      1,
                      Math.ceil((policyEventsQ.data?.total ?? 0) / policyEventsPageSize) || 1,
                    ),
                  ),
                })}
              </span>
              <Pagination
                className="resource-audit-audit-log-pagination mx-0"
                size="small"
                current={policyEventsPage}
                pageSize={policyEventsPageSize}
                total={policyEventsQ.data?.total ?? 0}
                onChange={(nextPage, nextPageSize) => {
                  if (nextPageSize && nextPageSize !== policyEventsPageSize) {
                    setPolicyEventsPageSize(nextPageSize);
                  }
                  setPolicyEventsPage(nextPage);
                }}
                showTotal
                bufferSize={1}
                sizeCanChange
                sizeOptions={[...PAGE_SIZE_OPTIONS]}
                showJumper
                disabled={policyEventsQ.isFetching}
              />
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
