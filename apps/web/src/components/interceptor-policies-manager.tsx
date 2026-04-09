"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Table, Button, Modal, Form, Input, Select, Switch, Message, Tag, Space, Popconfirm } from "@arco-design/web-react";
import { IconEdit, IconDelete } from "@arco-design/web-react/icon";
import { loadApiKey, loadCollectorUrl, collectorAuthHeaders } from "@/lib/collector";

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
  const t = useTranslations("Settings");
  const queryClient = useQueryClient();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<Partial<InterceptionPolicy> | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    if (!templatePolicy) {
      return;
    }

    setEditingPolicy(null);
    form.setFieldsValue({
      name: templatePolicy.name ?? "",
      description: templatePolicy.description ?? "",
      pattern: templatePolicy.pattern ?? "",
      redact_type: templatePolicy.redact_type ?? "mask",
      targets: templatePolicy.targets ?? ["prompt", "assistantTexts"],
      enabled: templatePolicy.enabled !== 0,
    });
    setIsModalVisible(true);
    onTemplatePolicyHandled?.();
  }, [templatePolicy, form, onTemplatePolicyHandled]);

  const collectorUrl = loadCollectorUrl();
  const apiKey = loadApiKey();

  const { data: policies = [], isLoading, dataUpdatedAt } = useQuery({
    queryKey: ["interception-policies", collectorUrl],
    queryFn: async () => {
      const url = `${collectorUrl.replace(/\/+$/, "")}/v1/policies`;
      const headers: Record<string, string> = { 
        "Accept": "application/json",
        ...collectorAuthHeaders(apiKey) as any,
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

  const fetchTime = dataUpdatedAt ? new Date(dataUpdatedAt) : null;
  const formatPolicyTime = (ms?: number | null) => ms ? new Date(ms).toLocaleString() : "—";

  const normalizedSearch = (searchQuery || "").trim().toLowerCase();
  const filteredPolicies = useMemo(() => {
    return policies.filter((policy) => {
      if (normalizedSearch) {
        const searchIn = [
          policy.name,
          policy.description || "",
          policy.pattern,
          policy.targets_json,
        ].join(" ").toLowerCase();
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

  const upsertMutation = useMutation({
    mutationFn: async (policy: Partial<InterceptionPolicy>) => {
      const url = `${collectorUrl.replace(/\/+$/, "")}/v1/policies`;
      const headers: Record<string, string> = { 
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...collectorAuthHeaders(apiKey) as any,
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
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const url = `${collectorUrl.replace(/\/+$/, "")}/v1/policies/${id}`;
      const headers: Record<string, string> = { 
        "Accept": "application/json",
        ...collectorAuthHeaders(apiKey) as any,
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
      Message.success(t("deleteOk") || "Deleted successfully");
    },
    onError: (err) => {
      Message.error(String(err));
    }
  });

  const handleEdit = (policy: InterceptionPolicy) => {
    setEditingPolicy(policy);
    form.setFieldsValue({
      ...policy,
      enabled: policy.enabled === 1,
      targets: JSON.parse(policy.targets_json || "[]"),
    });
    setIsModalVisible(true);
  };

  const handleToggleEnabled = (policy: InterceptionPolicy) => {
    upsertMutation.mutate({
      ...policy,
      enabled: policy.enabled === 1 ? 0 : 1,
      targets_json: policy.targets_json,
    });
  };

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
    } catch (err) {
      // Validation error
    }
  };

  const columns = [
    {
      title: <span style={{ whiteSpace: 'nowrap' }}>{t("policyId")}</span>,
      dataIndex: "id",
      width: 250,
      render: (id: string) => <code className="text-xs bg-neutral-100 px-1 rounded">{id}</code>,
    },
    {
      title: <span style={{ whiteSpace: 'nowrap' }}>{t("policyName")}</span>,
      dataIndex: "name",
      render: (name: string, record: InterceptionPolicy) => (
        <Space direction="vertical" size={0}>
          <span className="font-medium text-neutral-900">{name}</span>
          <span className="text-xs text-neutral-500">{record.description || "—"}</span>
        </Space>
      ),
    },
    {
      title: <span style={{ whiteSpace: 'nowrap' }}>{t("policyPattern")}</span>,
      dataIndex: "pattern",
      render: (pattern: string) => <code className="text-xs bg-neutral-100 px-1 rounded">{pattern}</code>,
    },
    {
      title: <span style={{ whiteSpace: 'nowrap' }}>{t("policyCreatedAt")}</span>,
      dataIndex: "created_at_ms",
      render: (created_at_ms?: number | null) => formatPolicyTime(created_at_ms),
    },
    {
      title: <span style={{ whiteSpace: 'nowrap' }}>{t("policyUpdatedAt")}</span>,
      dataIndex: "updated_at_ms",
      render: (updated_at_ms: number) => formatPolicyTime(updated_at_ms),
    },
    {
      title: <span style={{ whiteSpace: 'nowrap' }}>{t("policyPulledAt")}</span>,
      dataIndex: "pulled_at_ms",
      render: (pulled_at_ms?: number | null) => formatPolicyTime(pulled_at_ms ?? fetchTime),
    },
    {
      title: <span style={{ whiteSpace: 'nowrap' }}>{t("policyRedactType")}</span>,
      dataIndex: "redact_type",
      render: (type: string) => {
        const colors: Record<string, string> = {
          mask: "arcoblue",
          hash: "purple",
          block: "red",
        };
        return <Tag color={colors[type]}>{type.toUpperCase()}</Tag>;
      },
    },
    {
      title: <span style={{ whiteSpace: 'nowrap' }}>{t("policyEnabled")}</span>,
      dataIndex: "enabled",
      render: (enabled: number, record: InterceptionPolicy) => (
        <Switch
          checked={enabled === 1}
          onChange={() => handleToggleEnabled(record)}
          size="small"
        />
      ),
    },
    {
      title: <span style={{ whiteSpace: 'nowrap' }}>操作</span>,
      key: "actions",
      fixed: "right",
      width: 120,
      render: (_: any, record: InterceptionPolicy) => (
        <Space>
          <Button type="text" size="small" icon={<IconEdit />} onClick={() => handleEdit(record)} />
          <Popconfirm
            title={t("deletePolicyConfirm")}
            onOk={() => deleteMutation.mutate(record.id)}
          >
            <Button type="text" size="small" status="danger" icon={<IconDelete />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Table
        loading={isLoading}
        columns={columns}
        data={filteredPolicies}
        rowKey="id"
        pagination={false}
        scroll={{ x: 1200 }}
        noDataElement={<div className="py-8 text-center text-neutral-500">{t("noPolicies")}</div>}
      />

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
          <Form.Item 
            label={t("policyPattern")} 
            field="pattern" 
            rules={[{ required: true }]}
            extra="用于匹配敏感信息的正则，如 1[3-9]\d{9}"
          >
            <Input placeholder="RegExp pattern" />
          </Form.Item>
          <Form.Item label={t("policyRedactType")} field="redact_type" initialValue="mask">
            <Select>
              <Option value="mask">遮蔽 (Mask) - 如 138****1234</Option>
              <Option value="hash">哈希 (Hash) - 如 [HASH:a1b2c3d4]</Option>
              <Option value="block">阻断 (Block) - 如 [REDACTED]</Option>
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
