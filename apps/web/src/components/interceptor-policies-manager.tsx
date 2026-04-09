"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { TableProps } from "@arco-design/web-react";
import { Table, Button, Modal, Form, Input, Select, Switch, Message, Tag, Space, Popconfirm } from "@arco-design/web-react";
import { IconEdit, IconDelete } from "@arco-design/web-react/icon";
import { loadApiKey, loadCollectorUrl, collectorAuthHeaders } from "@/lib/collector";
import { ObserveTableHeaderLabel } from "@/components/observe-table-header-label";
import { ScrollableTableFrame } from "@/components/scrollable-table-frame";
import { TraceCopyIconButton } from "@/components/trace-copy-icon-button";
import { OBSERVE_TABLE_FRAME_CLASSNAME, OBSERVE_TABLE_SCROLL_X } from "@/lib/observe-table-style";
import { formatShortId } from "@/lib/utils";

import "@/lib/arco-react19-setup";

const Option = Select.Option;

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
  intercept_mode?: string | null;
  created_at_ms?: number | null;
  updated_at_ms: number;
  pulled_at_ms?: number | null;
}

export function InterceptorPoliciesManager({
  templatePolicy,
  onTemplatePolicyHandled,
  searchQuery = "",
  enabledFilter = "all",
  redactTypeFilter = "",
}: {
  templatePolicy?: Partial<InterceptionPolicy> & { targets?: string[] } | null;
  onTemplatePolicyHandled?: () => void;
  searchQuery?: string;
  enabledFilter?: "all" | "enabled" | "disabled";
  redactTypeFilter?: "" | "mask" | "hash" | "block";
}) {
  const t = useTranslations("DataSecurity");
  const queryClient = useQueryClient();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<Partial<InterceptionPolicy> | null>(null);
  const [form] = Form.useForm();
  /** 创建时间列排序：默认最新在前（与 Trace 列表时间倒序一致） */
  const [createdSortOrder, setCreatedSortOrder] = useState<"ascend" | "descend">("descend");

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
      redact_type: templatePolicy.redact_type ?? "mask",
      severity: tp?.severity ?? "high",
      policy_action: tp?.policy_action ?? "mask",
      intercept_mode: tp?.intercept_mode ?? "observe",
      targets: templatePolicy.targets ?? ["prompt", "assistantTexts"],
      enabled: templatePolicy.enabled !== 0,
    });
    setIsModalVisible(true);
    onTemplatePolicyHandled?.();
  }, [templatePolicy, form, onTemplatePolicyHandled]);

  const collectorUrl = loadCollectorUrl();
  const apiKey = loadApiKey();

  const { data: policies = [], isLoading } = useQuery({
    queryKey: ["interception-policies", collectorUrl],
    queryFn: async () => {
      const url = `${collectorUrl.replace(/\/+$/, "")}/v1/policies`;
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

  const normalizedSearch = (searchQuery || "").trim().toLowerCase();
  const filteredPolicies = useMemo(() => {
    return policies.filter((policy) => {
      if (normalizedSearch) {
        const searchIn = [policy.name, policy.description || "", policy.pattern, policy.targets_json].join(" ").toLowerCase();
        if (!searchIn.includes(normalizedSearch)) {
          return false;
        }
      }

      if (enabledFilter === "enabled" && policy.enabled !== 1) {
        return false;
      }
      if (enabledFilter === "disabled" && policy.enabled === 1) {
        return false;
      }
      if (redactTypeFilter && policy.redact_type !== redactTypeFilter) {
        return false;
      }

      return true;
    });
  }, [policies, normalizedSearch, enabledFilter, redactTypeFilter]);

  const sortedPolicies = useMemo(() => {
    const arr = [...filteredPolicies];
    arr.sort((a, b) => {
      const ta = a.created_at_ms != null && Number.isFinite(a.created_at_ms) ? a.created_at_ms : 0;
      const tb = b.created_at_ms != null && Number.isFinite(b.created_at_ms) ? b.created_at_ms : 0;
      return createdSortOrder === "descend" ? tb - ta : ta - tb;
    });
    return arr;
  }, [filteredPolicies, createdSortOrder]);

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
      const url = `${collectorUrl.replace(/\/+$/, "")}/v1/policies`;
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
      const url = `${collectorUrl.replace(/\/+$/, "")}/v1/policies/${id}`;
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
        policy_action: policy.policy_action ?? "mask",
        intercept_mode: policy.intercept_mode ?? "enforce",
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
      const payload: Partial<InterceptionPolicy> = {
        ...values,
        id: editingPolicy?.id,
        enabled: values.enabled ? 1 : 0,
        targets_json: JSON.stringify(values.targets || []),
      };
      upsertMutation.mutate(payload);
    } catch {
      // Validation error
    }
  };

  const columns = useMemo(
    () => [
      {
        title: <ObserveTableHeaderLabel>{t("policyId")}</ObserveTableHeaderLabel>,
        dataIndex: "id",
        key: "id",
        width: 220,
        fixed: "left" as const,
        render: (id: string) => (
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
        ),
      },
      {
        title: <ObserveTableHeaderLabel>{t("policyName")}</ObserveTableHeaderLabel>,
        dataIndex: "name",
        key: "name",
        render: (name: string, record: InterceptionPolicy) => (
          <Space direction="vertical" size={0}>
            <span className="text-xs text-neutral-800 dark:text-neutral-100">{name}</span>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">{record.description || "—"}</span>
          </Space>
        ),
      },
      {
        title: <ObserveTableHeaderLabel>{t("policyPattern")}</ObserveTableHeaderLabel>,
        dataIndex: "pattern",
        key: "pattern",
        render: (pattern: string) => (
          <span className="break-all text-xs text-neutral-800 dark:text-neutral-100" title={pattern}>
            {pattern}
          </span>
        ),
      },
      {
        title: <ObserveTableHeaderLabel>{t("policySeverity")}</ObserveTableHeaderLabel>,
        dataIndex: "severity",
        key: "severity",
        width: 88,
        render: (severity: string | null | undefined) => {
          const s = severity ?? "high";
          const color = s === "critical" ? "red" : s === "low" ? "green" : "orange";
          const label =
            s === "low" ? t("policySeverityLow") : s === "critical" ? t("policySeverityCritical") : t("policySeverityHigh");
          return (
            <Tag color={color} className="text-xs">
              {label}
            </Tag>
          );
        },
      },
      {
        title: <ObserveTableHeaderLabel>{t("policyAction")}</ObserveTableHeaderLabel>,
        dataIndex: "policy_action",
        key: "policy_action",
        width: 120,
        render: (action: string | null | undefined) => {
          const a = action ?? "mask";
          const labelKey =
            a === "hash"
              ? "policyActionHash"
              : a === "vault_token"
                ? "policyActionVaultToken"
                : a === "pseudonymize"
                  ? "policyActionPseudonymize"
                  : a === "block_message"
                    ? "policyActionBlockMessage"
                    : a === "abort_run"
                      ? "policyActionAbortRun"
                      : a === "alert_only"
                        ? "policyActionAlertOnly"
                        : "policyActionMask";
          return (
            <Tag color="arcoblue" className="max-w-[8rem] truncate text-xs" title={a}>
              {t(labelKey)}
            </Tag>
          );
        },
      },
      {
        title: <ObserveTableHeaderLabel>{t("policyInterceptMode")}</ObserveTableHeaderLabel>,
        dataIndex: "intercept_mode",
        key: "intercept_mode",
        width: 108,
        render: (mode: string | null | undefined) => {
          const m = mode ?? "enforce";
          const enforce = m === "enforce";
          return (
            <Tag color={enforce ? "blue" : "orangered"} className="text-xs">
              {enforce ? t("policyModeEnforce") : t("policyModeObserve")}
            </Tag>
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
        title: <ObserveTableHeaderLabel>{t("policyRedactType")}</ObserveTableHeaderLabel>,
        dataIndex: "redact_type",
        key: "redact_type",
        render: (type: string) => {
          const colors: Record<string, string> = {
            mask: "arcoblue",
            hash: "purple",
            block: "red",
          };
          return (
            <Tag color={colors[type]} className="text-xs">
              {type.toUpperCase()}
            </Tag>
          );
        },
      },
      {
        title: <ObserveTableHeaderLabel>{t("policyEnabled")}</ObserveTableHeaderLabel>,
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
            <Button type="text" size="small" icon={<IconEdit />} onClick={() => handleEdit(record)} />
            <Popconfirm title={t("deletePolicyConfirm")} onOk={() => deleteMutation.mutate(record.id)}>
              <Button type="text" size="small" status="danger" icon={<IconDelete />} />
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [t, createdSortOrder, handleEdit, handleToggleEnabled, deleteMutation],
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
              data={sortedPolicies}
              rowKey="id"
              pagination={false}
              scroll={OBSERVE_TABLE_SCROLL_X}
              hover
              loading={isLoading}
              onChange={onTableChange}
              noDataElement={<div className="flex justify-center px-4 py-10 text-xs text-neutral-500">{t("noPolicies")}</div>}
            />
          </div>
        </ScrollableTableFrame>
      </div>

      <Modal
        title={editingPolicy ? t("editPolicy") : t("addPolicy")}
        visible={isModalVisible}
        onOk={handleSubmit}
        confirmLoading={upsertMutation.isPending}
        onCancel={() => setIsModalVisible(false)}
        style={{ width: 520 }}
      >
        <Form form={form} layout="vertical">
          <Form.Item label={t("policyName")} field="name" rules={[{ required: true }]}>
            <Input placeholder="例如：拦截手机号" />
          </Form.Item>
          <Form.Item label={t("policyDescription")} field="description">
            <Input.TextArea placeholder="可选描述" />
          </Form.Item>
          <Form.Item label={t("policyPattern")} field="pattern" rules={[{ required: true }]} extra="用于匹配敏感信息的正则，如 1[3-9]\d{9}">
            <Input placeholder="RegExp pattern" />
          </Form.Item>
          <Form.Item label={t("policyRedactType")} field="redact_type" initialValue="mask">
            <Select>
              <Option value="mask">遮蔽 (Mask) - 如 138****1234</Option>
              <Option value="hash">哈希 (Hash) - 如 [HASH:a1b2c3d4]</Option>
              <Option value="block">阻断 (Block) - 如 [REDACTED]</Option>
            </Select>
          </Form.Item>
          <Form.Item label={t("policySeverity")} field="severity" initialValue="high">
            <Select>
              <Option value="low">{t("policySeverityLow")}</Option>
              <Option value="high">{t("policySeverityHigh")}</Option>
              <Option value="critical">{t("policySeverityCritical")}</Option>
            </Select>
          </Form.Item>
          <Form.Item label={t("policyAction")} field="policy_action" initialValue="mask">
            <Select>
              <Option value="mask">{t("policyActionMask")}</Option>
              <Option value="hash">{t("policyActionHash")}</Option>
              <Option value="vault_token">{t("policyActionVaultToken")}</Option>
              <Option value="pseudonymize">{t("policyActionPseudonymize")}</Option>
              <Option value="block_message">{t("policyActionBlockMessage")}</Option>
              <Option value="abort_run">{t("policyActionAbortRun")}</Option>
              <Option value="alert_only">{t("policyActionAlertOnly")}</Option>
            </Select>
          </Form.Item>
          <Form.Item label={t("policyInterceptMode")} field="intercept_mode" initialValue="observe">
            <Select>
              <Option value="enforce">{t("policyModeEnforce")}</Option>
              <Option value="observe">{t("policyModeObserve")}</Option>
            </Select>
          </Form.Item>
          <Form.Item
            label={t("policyTargets")}
            field="targets"
            initialValue={["prompt", "assistantTexts"]}
            extra="指定哪些字段需要进行脱敏处理"
          >
            <Select mode="multiple" placeholder="选择字段">
              <Option value="prompt">用户 Prompt</Option>
              <Option value="assistantTexts">模型输出 (Assistant)</Option>
              <Option value="tool_params">工具调用参数</Option>
              <Option value="metadata">元数据 (Metadata)</Option>
            </Select>
          </Form.Item>
          <Form.Item label={t("policyEnabled")} field="enabled" triggerPropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
