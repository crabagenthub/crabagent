"use client";

import "@/lib/arco-react19-setup";
import {
  Button,
  Card,
  Input,
  InputNumber,
  Message,
  Modal,
  Radio,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
} from "@arco-design/web-react";
import type { TableColumnProps } from "@arco-design/web-react";
import { IconDelete, IconEdit, IconPlus } from "@arco-design/web-react/icon";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppPageShell } from "@/components/app-page-shell";
import {
  appendAlertHistory,
  newRuleId,
  readAlertHistory,
  readAlertRules,
  writeAlertRules,
  type AlertDelivery,
  type AlertHistoryEntry,
  type AlertMetricKey,
  type AlertOperator,
  type AlertRule,
  type AlertWebhookType,
} from "@/lib/alert-rules-storage";
import { cn } from "@/lib/utils";

type TemplateDef = {
  id: string;
  metricKey: AlertMetricKey;
  operator: AlertOperator;
  threshold: number;
  windowMinutes: number;
};

const TEMPLATES: TemplateDef[] = [
  {
    id: "error_spike",
    metricKey: "error_rate_pct",
    operator: "gt",
    threshold: 5,
    windowMinutes: 5,
  },
  {
    id: "high_cost",
    metricKey: "estimated_daily_cost_usd",
    operator: "gt",
    threshold: 10,
    windowMinutes: 1440,
  },
  {
    id: "slow",
    metricKey: "p95_latency_ms",
    operator: "gt",
    threshold: 3000,
    windowMinutes: 15,
  },
  {
    id: "pii",
    metricKey: "sensitive_data_hits",
    operator: "gt",
    threshold: 1,
    windowMinutes: 5,
  },
  {
    id: "agent_offline",
    metricKey: "trace_count",
    operator: "lt",
    threshold: 1,
    windowMinutes: 30,
  },
];

function templateTitle(t: ReturnType<typeof useTranslations<"Alerts">>, id: string): string {
  switch (id) {
    case "error_spike":
      return t("tplErrorSpikeName");
    case "high_cost":
      return t("tplHighCostName");
    case "slow":
      return t("tplSlowName");
    case "pii":
      return t("tplPiiName");
    case "agent_offline":
      return t("tplOfflineName");
    default:
      return id;
  }
}

function templateDesc(t: ReturnType<typeof useTranslations<"Alerts">>, id: string): string {
  switch (id) {
    case "error_spike":
      return t("tplErrorSpikeDesc");
    case "high_cost":
      return t("tplHighCostDesc");
    case "slow":
      return t("tplSlowDesc");
    case "pii":
      return t("tplPiiDesc");
    case "agent_offline":
      return t("tplOfflineDesc");
    default:
      return "";
  }
}

const METRIC_OPTIONS: AlertMetricKey[] = [
  "error_rate_pct",
  "estimated_daily_cost_usd",
  "p95_latency_ms",
  "sensitive_data_hits",
  "trace_count",
];

function metricLabel(t: ReturnType<typeof useTranslations<"Alerts">>, k: AlertMetricKey): string {
  const map: Record<AlertMetricKey, string> = {
    error_rate_pct: t("metric_error_rate_pct"),
    estimated_daily_cost_usd: t("metric_estimated_daily_cost_usd"),
    p95_latency_ms: t("metric_p95_latency_ms"),
    sensitive_data_hits: t("metric_sensitive_data_hits"),
    trace_count: t("metric_trace_count"),
  };
  return map[k] ?? k;
}

function opLabel(t: ReturnType<typeof useTranslations<"Alerts">>, o: AlertOperator): string {
  if (o === "gt") {
    return t("opGt");
  }
  if (o === "lt") {
    return t("opLt");
  }
  return t("opEq");
}

function formatRuleSummary(rule: AlertRule, t: ReturnType<typeof useTranslations<"Alerts">>): string {
  return `${metricLabel(t, rule.metricKey)} ${opLabel(t, rule.operator)} ${rule.threshold} · ${t("windowSummary", { n: String(rule.windowMinutes) })}`;
}

/** 与总览 / 资源审计等页一致的卡片壳 */
const cardShellClass =
  "overflow-hidden rounded-lg border border-solid border-[#E5E6EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:border-border dark:bg-card dark:shadow-sm";

export function AlertsDashboard() {
  const t = useTranslations("Alerts");
  const [mounted, setMounted] = useState(false);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [history, setHistory] = useState<AlertHistoryEntry[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AlertRule | null>(null);

  const [name, setName] = useState("");
  const [metricKey, setMetricKey] = useState<AlertMetricKey>("error_rate_pct");
  const [operator, setOperator] = useState<AlertOperator>("gt");
  const [threshold, setThreshold] = useState<number>(5);
  const [windowMinutes, setWindowMinutes] = useState<number>(5);
  const [delivery, setDelivery] = useState<AlertDelivery>("webhook");
  const [webhookType, setWebhookType] = useState<AlertWebhookType>("slack");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [email, setEmail] = useState("");
  const [enabled, setEnabled] = useState(true);

  const reload = useCallback(() => {
    setRules(readAlertRules());
    setHistory(readAlertHistory());
  }, []);

  useEffect(() => {
    setMounted(true);
    reload();
  }, [reload]);

  const openCreate = useCallback(() => {
    setEditingId(null);
    setName("");
    setMetricKey("error_rate_pct");
    setOperator("gt");
    setThreshold(5);
    setWindowMinutes(5);
    setDelivery("webhook");
    setWebhookType("slack");
    setWebhookUrl("");
    setEmail("");
    setEnabled(true);
    setModalOpen(true);
  }, []);

  const applyTemplate = useCallback(
    (tpl: TemplateDef) => {
      setEditingId(null);
      setName(templateTitle(t, tpl.id));
      setMetricKey(tpl.metricKey);
      setOperator(tpl.operator);
      setThreshold(tpl.threshold);
      setWindowMinutes(tpl.windowMinutes);
      setDelivery("webhook");
      setWebhookType("slack");
      setWebhookUrl("");
      setEmail("");
      setEnabled(true);
      setModalOpen(true);
    },
    [t],
  );

  const openEdit = useCallback((rule: AlertRule) => {
    setEditingId(rule.id);
    setName(rule.name);
    setMetricKey(rule.metricKey);
    setOperator(rule.operator);
    setThreshold(rule.threshold);
    setWindowMinutes(rule.windowMinutes);
    setDelivery(rule.delivery);
    setWebhookType(rule.webhookType);
    setWebhookUrl(rule.webhookUrl);
    setEmail(rule.email);
    setEnabled(rule.enabled);
    setModalOpen(true);
  }, []);

  const saveRule = useCallback(() => {
    const n = name.trim();
    if (!n) {
      Message.warning(t("validateName"));
      return;
    }
    if (delivery === "webhook" && !webhookUrl.trim()) {
      Message.warning(t("validateWebhook"));
      return;
    }
    if (delivery === "email" && !email.trim()) {
      Message.warning(t("validateEmail"));
      return;
    }
    const now = Date.now();
    const next: AlertRule = {
      id: editingId ?? newRuleId(),
      name: n,
      metricKey,
      operator,
      threshold: Number(threshold),
      windowMinutes: Math.max(1, Math.floor(Number(windowMinutes)) || 1),
      delivery,
      webhookType,
      webhookUrl: webhookUrl.trim(),
      email: email.trim(),
      enabled,
      createdAt: editingId ? rules.find((r) => r.id === editingId)?.createdAt ?? now : now,
      updatedAt: now,
    };
    const others = editingId ? rules.filter((r) => r.id !== editingId) : rules;
    writeAlertRules([next, ...others]);
    reload();
    setModalOpen(false);
    Message.success(t("saveOk"));
  }, [
    delivery,
    editingId,
    email,
    enabled,
    metricKey,
    name,
    operator,
    reload,
    rules,
    t,
    threshold,
    webhookType,
    webhookUrl,
    windowMinutes,
  ]);

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) {
      return;
    }
    writeAlertRules(rules.filter((r) => r.id !== deleteTarget.id));
    reload();
    setDeleteTarget(null);
    Message.success(t("deleteOk"));
  }, [deleteTarget, reload, rules, t]);

  const toggleEnabled = useCallback(
    (rule: AlertRule, on: boolean) => {
      const now = Date.now();
      writeAlertRules(
        rules.map((r) => (r.id === rule.id ? { ...r, enabled: on, updatedAt: now } : r)),
      );
      reload();
    },
    [reload, rules],
  );

  const testNotify = useCallback(
    (rule: AlertRule) => {
      appendAlertHistory({
        ruleId: rule.id,
        ruleName: rule.name,
        firedAt: Date.now(),
        summary: formatRuleSummary(rule, t),
        status: "pending",
      });
      reload();
      Message.info(t("testNotifyQueued"));
    },
    [reload, t],
  );

  const historyColumns: TableColumnProps<AlertHistoryEntry>[] = useMemo(
    () => [
      {
        title: t("historyColTime"),
        dataIndex: "firedAt",
        width: 168,
        render: (ms: number) => (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {new Date(ms).toLocaleString()}
          </span>
        ),
      },
      {
        title: t("historyColRule"),
        dataIndex: "ruleName",
        ellipsis: true,
        render: (v: string) => (
          <Typography.Text className="text-xs text-foreground" ellipsis={{ showTooltip: true }}>
            {v}
          </Typography.Text>
        ),
      },
      {
        title: t("historyColSummary"),
        dataIndex: "summary",
        ellipsis: true,
        render: (v: string) => (
          <Typography.Text className="text-xs text-muted-foreground" ellipsis={{ showTooltip: true }}>
            {v}
          </Typography.Text>
        ),
      },
      {
        title: t("historyColStatus"),
        dataIndex: "status",
        width: 100,
        render: (s: string) => (
          <Tag size="small" color={s === "sent" ? "green" : s === "failed" ? "red" : "gray"}>
            {s === "sent" ? t("status_sent") : s === "failed" ? t("status_failed") : t("status_pending")}
          </Tag>
        ),
      },
    ],
    [t],
  );

  if (!mounted) {
    return (
      <AppPageShell variant="overview">
        <main className="ca-page relative z-[1] flex justify-center py-16">
          <Spin />
        </main>
      </AppPageShell>
    );
  }

  return (
    <AppPageShell variant="overview">
      <main className="ca-page relative z-[1] space-y-6 pb-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div>
            <Typography.Title heading={4} className="ca-page-title !m-0">
              {t("title")}
            </Typography.Title>
            <Typography.Paragraph type="secondary" className="!mb-0 !mt-1 max-w-2xl text-sm leading-relaxed">
              {t("pageBlurb")}
            </Typography.Paragraph>
          </div>
          <Button type="primary" className="shrink-0" onClick={openCreate}>
            <IconPlus className="mr-1 inline" />
            {t("newRule")}
          </Button>
        </header>

        <section aria-label={t("activeRules")} className="space-y-3">
          <Typography.Title heading={6} className="!m-0 text-sm font-semibold text-[#1D2129] dark:text-foreground">
            {t("activeRules")}
          </Typography.Title>

          {rules.length === 0 ? (
            <Card bordered={false} className={cn(cardShellClass)} bodyStyle={{ padding: "24px" }}>
              <div className="text-center">
                <Typography.Title heading={6} className="!m-0 text-[#1D2129] dark:text-foreground">
                  {t("noRulesTitle")}
                </Typography.Title>
                <Typography.Paragraph type="secondary" className="!mb-0 !mt-2 text-sm">
                  {t("noRulesHint")}
                </Typography.Paragraph>
              </div>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {rules.map((rule) => (
                <Card key={rule.id} bordered={false} className={cardShellClass} bodyStyle={{ padding: "16px" }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <Typography.Text bold className="block truncate text-[#1D2129] dark:text-foreground">
                        {rule.name}
                      </Typography.Text>
                      <p className="mt-1 text-xs leading-snug text-muted-foreground">{formatRuleSummary(rule, t)}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {rule.delivery === "webhook"
                          ? `${t("deliveryWebhookShort")}: ${rule.webhookType}`
                          : t("deliveryEmailShort")}
                      </p>
                    </div>
                    <Switch checked={rule.enabled} size="small" onChange={(v) => toggleEnabled(rule, v)} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button type="outline" size="small" onClick={() => testNotify(rule)}>
                      {t("testNotify")}
                    </Button>
                    <Button type="outline" size="small" icon={<IconEdit />} onClick={() => openEdit(rule)}>
                      {t("editRule")}
                    </Button>
                    <Button type="outline" size="small" status="danger" icon={<IconDelete />} onClick={() => setDeleteTarget(rule)}>
                      {t("deleteRule")}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {TEMPLATES.map((tpl) => (
              <Card key={tpl.id} bordered={false} className={cn(cardShellClass, "flex flex-col")} bodyStyle={{ padding: "16px" }}>
                <Typography.Text bold className="text-sm text-[#1D2129] dark:text-foreground">
                  {templateTitle(t, tpl.id)}
                </Typography.Text>
                <p className="mt-2 min-h-[3rem] flex-1 text-xs leading-relaxed text-muted-foreground">
                  {templateDesc(t, tpl.id)}
                </p>
                <Button type="primary" size="small" className="mt-4 w-full" onClick={() => applyTemplate(tpl)}>
                  {t("templateAdd")}
                </Button>
              </Card>
            ))}
          </div>
        </section>

        <section aria-label={t("alertHistory")} className="space-y-3">
          <Typography.Title heading={6} className="!m-0 text-sm font-semibold text-[#1D2129] dark:text-foreground">
            {t("alertHistory")}
          </Typography.Title>
          <Card bordered={false} className={cardShellClass} bodyStyle={{ padding: 0 }}>
            {history.length === 0 ? (
              <div className="py-14 text-center text-sm text-muted-foreground">{t("noHistory")}</div>
            ) : (
              <Table
                size="small"
                rowKey="id"
                columns={historyColumns}
                data={history}
                pagination={false}
                border={{ wrapper: false, cell: false, headerCell: false, bodyCell: false }}
                className="[&_.arco-table-th]:bg-[#f7f9fc] [&_.arco-table-th.arco-table-col-sorted]:bg-[#f7f9fc] dark:[&_.arco-table-th]:bg-muted/50"
              />
            )}
          </Card>
        </section>

        <Modal
          title={editingId ? t("modalEditTitle") : t("modalCreateTitle")}
          visible={modalOpen}
          onOk={saveRule}
          onCancel={() => setModalOpen(false)}
          okText={t("saveRule")}
          cancelText={t("cancel")}
          unmountOnExit
        >
          <div className="space-y-4 pt-2">
            <div>
              <div className="mb-1 text-xs text-muted-foreground">{t("formName")}</div>
              <Input value={name} onChange={setName} placeholder={t("formNamePh")} />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">{t("formWhen")}</div>
              <Space wrap className="w-full">
                <Select value={metricKey} onChange={(v) => setMetricKey(v as AlertMetricKey)} style={{ minWidth: 200 }}>
                  {METRIC_OPTIONS.map((k) => (
                    <Select.Option key={k} value={k}>
                      {metricLabel(t, k)}
                    </Select.Option>
                  ))}
                </Select>
                <Select value={operator} onChange={(v) => setOperator(v as AlertOperator)} style={{ width: 140 }}>
                  <Select.Option value="gt">{t("opGt")}</Select.Option>
                  <Select.Option value="lt">{t("opLt")}</Select.Option>
                  <Select.Option value="eq">{t("opEq")}</Select.Option>
                </Select>
                <InputNumber value={threshold} onChange={(v) => setThreshold(Number(v ?? 0))} min={0} style={{ width: 120 }} />
              </Space>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">{t("formWindow")}</div>
              <Space>
                <InputNumber value={windowMinutes} onChange={(v) => setWindowMinutes(Number(v ?? 1))} min={1} style={{ width: 120 }} />
                <span className="text-sm text-muted-foreground">{t("minutesLabel")}</span>
              </Space>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">{t("formDelivery")}</div>
              <Radio.Group value={delivery} onChange={(v) => setDelivery(v as AlertDelivery)}>
                <Radio value="webhook">{t("deliveryWebhook")}</Radio>
                <Radio value="email">{t("deliveryEmail")}</Radio>
              </Radio.Group>
            </div>
            {delivery === "webhook" ? (
              <>
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">{t("formWebhookType")}</div>
                  <Select value={webhookType} onChange={(v) => setWebhookType(v as AlertWebhookType)} style={{ width: 160 }}>
                    <Select.Option value="slack">{t("webhookSlack")}</Select.Option>
                    <Select.Option value="generic">{t("webhookGeneric")}</Select.Option>
                  </Select>
                </div>
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">{t("formWebhookUrl")}</div>
                  <Input value={webhookUrl} onChange={setWebhookUrl} placeholder="https://hooks.slack.com/..." />
                </div>
              </>
            ) : (
              <div>
                <div className="mb-1 text-xs text-muted-foreground">{t("formEmail")}</div>
                <Input value={email} onChange={setEmail} placeholder="ops@example.com" />
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch checked={enabled} onChange={setEnabled} />
              <span className="text-sm text-muted-foreground">{t("formEnabled")}</span>
            </div>
          </div>
        </Modal>

        <Modal
          title={t("deleteConfirmTitle")}
          visible={deleteTarget != null}
          onOk={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
          okText={t("confirmDelete")}
          cancelText={t("cancel")}
          okButtonProps={{ status: "danger" }}
        >
          <p className="text-sm text-muted-foreground">{t("deleteConfirmBody", { name: deleteTarget?.name ?? "" })}</p>
        </Modal>
      </main>
    </AppPageShell>
  );
}
