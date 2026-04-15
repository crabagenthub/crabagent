"use client";

import { useCallback, useState } from "react";
import Input from "@arco-design/web-react/es/Input";
import { IconSearch, IconList, IconApps, IconPlus, IconFile, IconInfoCircle } from "@arco-design/web-react/icon";
import { useTranslations } from "next-intl";
import { AppPageShell } from "@/components/app-page-shell";
import { InterceptorPoliciesManager } from "@/components/interceptor-policies-manager";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardDescription, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type PolicyTemplate = {
  id: string;
  nameKey: string;
  summaryKey: string;
  pattern: string;
  example: string;
  targets: string[];
  redactType: "mask" | "hash" | "block";
};

const POLICY_TEMPLATES: PolicyTemplate[] = [
  {
    id: "mobile",
    nameKey: "templateNameMobile",
    summaryKey: "templateSummaryMobile",
    pattern: "\\b1[3-9]\\d{9}\\b",
    example: "13812345678",
    targets: ["prompt", "assistantTexts", "tool_params"],
    redactType: "mask",
  },
  {
    id: "nationalId",
    nameKey: "templateNameNationalId",
    summaryKey: "templateSummaryNationalId",
    pattern: "\\b\\d{6}(18|19|20)\\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\\d|3[01])\\d{3}[0-9Xx]\\b",
    example: "110105199001011234",
    targets: ["prompt", "assistantTexts"],
    redactType: "mask",
  },
  {
    id: "email",
    nameKey: "templateNameEmail",
    summaryKey: "templateSummaryEmail",
    pattern: "(?<!://)(?<![\\w.-]:\\S{0,50})\\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+\\.(?:[a-zA-Z]{2,})\\b(?!:\\d)",
    example: "user@example.com",
    targets: ["prompt", "assistantTexts", "tool_params"],
    redactType: "hash",
  },
  {
    id: "ip",
    nameKey: "templateNameIp",
    summaryKey: "templateSummaryIp",
    pattern: "\\b(?:(?:25[0-5]|2[0-4]\\d|[01]?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|[01]?\\d?\\d)\\b",
    example: "192.168.0.1",
    targets: ["prompt", "assistantTexts", "metadata"],
    redactType: "mask",
  },
  {
    id: "postalCode",
    nameKey: "templateNamePostalCode",
    summaryKey: "templateSummaryPostalCode",
    pattern: "\\b\\d{6}\\b",
    example: "100000",
    targets: ["prompt", "assistantTexts"],
    redactType: "mask",
  },
  {
    id: "apiKey",
    nameKey: "templateNameApiKey",
    summaryKey: "templateSummaryApiKey",
    pattern: "\\b(?:api[-_]?(?:key|token|secret)|access[-_]?key|auth[-_]?(?:token|key))[=:]?\\s*[A-Za-z0-9-_]{16,128}\\b",
    example: "api_key=1234567890abcdef1234567890abcdef",
    targets: ["prompt", "assistantTexts", "tool_params", "metadata"],
    redactType: "block",
  },
  {
    id: "password",
    nameKey: "templateNamePassword",
    summaryKey: "templateSummaryPassword",
    pattern:
      "\\b(?:[Pp]assword|[Pp]asswd|[Pp]wd|[Ss]ecret|[Tt]oken|[Aa]pi[_-]?[Ss]ecret)[=:]\\s*\\S+\\b",
    example: "password=MyS3cret!",
    targets: ["prompt", "assistantTexts", "tool_params"],
    redactType: "block",
  },
  {
    id: "dbConnection",
    nameKey: "templateNameDbConnection",
    summaryKey: "templateSummaryDbConnection",
    pattern: `\\b(?:mongodb(?:\\+srv)?:\\/\\/[^"']+|postgres(?:ql)?:\\/\\/[^"']+|mysql(?:\\+[a-zA-Z0-9]+)?:\\/\\/\\S+|mysql:host=\\S+|redis:\\/\\/\\S+|jdbc:[^\\s]+)\\b`,
    example: "mongodb://user:pass@host:27017/db",
    targets: ["prompt", "assistantTexts", "tool_params", "metadata"],
    redactType: "block",
  },
  {
    id: "sshPrivateKey",
    nameKey: "templateNameSshPrivateKey",
    summaryKey: "templateSummarySshPrivateKey",
    pattern: "-----BEGIN [A-Z ]*PRIVATE KEY-----",
    example: "-----BEGIN OPENSSH PRIVATE KEY-----",
    targets: ["prompt", "assistantTexts", "tool_params", "metadata"],
    redactType: "block",
  },
  {
    id: "bankCard",
    nameKey: "templateNameBankCard",
    summaryKey: "templateSummaryBankCard",
    pattern: "\\b(?:\\d[ -]*?){13,19}\\b",
    example: "6222 2222 2222 2222",
    targets: ["prompt", "assistantTexts"],
    redactType: "mask",
  },
  {
    id: "socialCredit",
    nameKey: "templateNameSocialCredit",
    summaryKey: "templateSummarySocialCredit",
    pattern: "\\b[0-9A-Z]{18}\\b",
    example: "91310106584324886F",
    targets: ["prompt", "assistantTexts"],
    redactType: "hash",
  },
  {
    id: "licensePlate",
    nameKey: "templateNameLicensePlate",
    summaryKey: "templateSummaryLicensePlate",
    pattern: "\\b[京津沪渝粤苏浙皖闽赣晋辽吉黑湘鄂豫鲁新川贵云桂琼陕甘青宁蒙藏宁][A-Z][A-Z0-9]{5}\\b",
    example: "粤B12345",
    targets: ["prompt", "assistantTexts"],
    redactType: "mask",
  },
];

/** 模板卡片标题前图标的浅色底（循环使用） */
const TEMPLATE_CARD_ICON_BG = [
  "bg-violet-500/15 text-violet-700 dark:bg-violet-400/20 dark:text-violet-200",
  "bg-sky-500/15 text-sky-800 dark:bg-sky-400/20 dark:text-sky-200",
  "bg-emerald-500/15 text-emerald-800 dark:bg-emerald-400/20 dark:text-emerald-200",
  "bg-amber-500/15 text-amber-900 dark:bg-amber-400/20 dark:text-amber-100",
  "bg-rose-500/15 text-rose-800 dark:bg-rose-400/20 dark:text-rose-200",
  "bg-indigo-500/15 text-indigo-800 dark:bg-indigo-400/20 dark:text-indigo-200",
] as const;

type DataSecurityTemplatePolicy = {
  name: string;
  description: string;
  pattern: string;
  redact_type: "mask" | "hash" | "block";
  targets: string[];
  enabled: number;
  severity?: "low" | "high" | "critical";
  policy_action?: string;
};

export default function DataSecurityPage() {
  const t = useTranslations("DataSecurity");
  const [activeTab, setActiveTab] = useState<"policies" | "templates">("policies");
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [templatePolicy, setTemplatePolicy] = useState<Partial<DataSecurityTemplatePolicy> & { targets?: string[] } | null>(null);

  const handleRefreshList = useCallback(() => {
    setRefreshSignal((prev) => prev + 1);
  }, []);

  const handleAddPolicy = useCallback(() => {
    setTemplatePolicy({
      name: "",
      description: "",
      pattern: "",
      redact_type: "mask",
      targets: ["prompt", "assistantTexts"],
      enabled: 1,
      severity: "high",
      policy_action: "data_mask",
    });
  }, []);

  const handleUseTemplate = useCallback(
    (template: PolicyTemplate) => {
      setTemplatePolicy({
        name: t(template.nameKey),
        description: t(template.summaryKey),
        pattern: template.pattern,
        redact_type: "mask",
        targets: template.targets,
        enabled: 1,
        severity: "high",
        policy_action: "data_mask",
      });
      setActiveTab("policies");
    },
    [t],
  );

  return (
    <AppPageShell variant="data-security">
      <main className="ca-page relative z-[1]">
        <header className="mb-6">
          <h1 className="ca-page-title">{t("title")}</h1>
        </header>

        <section className="mb-4 space-y-3">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("policies")}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-[color,background-color] sm:px-3",
                activeTab === "policies"
                  ? "bg-[#f2f5fa] font-semibold text-neutral-800 dark:bg-zinc-800/75 dark:text-zinc-100"
                  : "text-neutral-600 hover:bg-[#f2f5fa] hover:text-neutral-900 dark:text-zinc-400 dark:hover:bg-zinc-800/75 dark:hover:text-zinc-100"
              )}
            >
              <IconList
                className={cn(
                  "size-4 shrink-0",
                  activeTab === "policies"
                    ? "text-neutral-800 dark:text-zinc-100"
                    : "text-neutral-600 dark:text-zinc-400"
                )}
                strokeWidth={activeTab === "policies" ? 3 : 2}
                aria-hidden
              />
              <span className="whitespace-nowrap">{t("tabPolicies")}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("templates")}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-[color,background-color] sm:px-3",
                activeTab === "templates"
                  ? "bg-[#f2f5fa] font-semibold text-neutral-800 dark:bg-zinc-800/75 dark:text-zinc-100"
                  : "text-neutral-600 hover:bg-[#f2f5fa] hover:text-neutral-900 dark:text-zinc-400 dark:hover:bg-zinc-800/75 dark:hover:text-zinc-100"
              )}
            >
              <IconApps
                className={cn(
                  "size-4 shrink-0",
                  activeTab === "templates"
                    ? "text-neutral-800 dark:text-zinc-100"
                    : "text-neutral-600 dark:text-zinc-400"
                )}
                strokeWidth={activeTab === "templates" ? 3 : 2}
                aria-hidden
              />
              <span className="whitespace-nowrap">{t("tabTemplates")}</span>
            </button>
          </div>
        </section>

        <section className="space-y-4">
          {activeTab === "policies" ? (
            <>
              <div className="rounded-xl border border-neutral-200/90 bg-neutral-50/40 p-2 shadow-sm dark:border-zinc-700/80 dark:bg-zinc-900/25 sm:p-2.5">
                <div className="flex flex-wrap items-center gap-2 gap-y-3 xl:flex-nowrap">
                  <div className="flex min-w-[min(100%,18rem)] max-w-[min(80rem,94vw)] shrink flex-1 basis-[min(100%,44rem)] items-center gap-2 sm:min-w-[22rem] md:basis-[min(100%,48rem)] lg:max-w-[min(88rem,94vw)]">
                    <div className="group/sch relative min-w-[12rem] flex-1">
                      <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-neutral-500 transition-colors duration-150 dark:text-zinc-500 group-hover/sch:text-neutral-600 dark:group-hover/sch:text-zinc-400 group-focus-within/sch:text-neutral-950 dark:group-focus-within/sch:text-zinc-50">
                        <IconSearch className="h-4 w-4" aria-hidden />
                      </span>
                      <Input
                        value={searchQuery}
                        onChange={(value) => setSearchQuery(value)}
                        placeholder={t("searchPlaceholder")}
                        allowClear
                        className="h-9 w-full rounded-md border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm text-neutral-800 shadow-sm outline-none transition-[color,box-shadow,border-color] placeholder:text-neutral-400 focus-visible:border-neutral-400 focus-visible:ring-2 focus-visible:ring-neutral-300/60 dark:border-zinc-600 dark:bg-zinc-950/50 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus-visible:border-zinc-500 dark:focus-visible:ring-zinc-600/50 group-hover/sch:placeholder:text-neutral-500 dark:group-hover/sch:placeholder:text-zinc-500"
                      />
                    </div>
                  </div>

                  <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2 xl:flex-nowrap">
                    <Button variant="outline" size="sm" onClick={handleRefreshList}>
                      {t("refreshList")}
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleAddPolicy}
                      className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl px-4 [&_svg]:size-4 [&_svg]:shrink-0"
                    >
                      <IconPlus aria-hidden />
                      {t("addPolicy")}
                    </Button>
                  </div>
                </div>
              </div>

              <div>
                <InterceptorPoliciesManager
                  templatePolicy={templatePolicy}
                  onTemplatePolicyHandled={() => setTemplatePolicy(null)}
                  searchQuery={searchQuery}
                  refreshSignal={refreshSignal}
                />
              </div>
            </>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {POLICY_TEMPLATES.map((template, templateIndex) => (
                <Card
                  key={template.id}
                  className="group overflow-hidden rounded-3xl border border-border bg-background transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/10 dark:border-zinc-700/80"
                >
                  <CardHeader>
                    <div>
                      <div className="flex items-start gap-3">
                        <span
                          className={cn(
                            "flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-4",
                            TEMPLATE_CARD_ICON_BG[templateIndex % TEMPLATE_CARD_ICON_BG.length],
                          )}
                          aria-hidden
                        >
                          <IconApps />
                        </span>
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <CardTitle className="text-base leading-snug sm:text-lg">{t(template.nameKey)}</CardTitle>
                          <CardDescription>{t(template.summaryKey)}</CardDescription>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pb-6">
                    <div className="space-y-4 text-sm">
                      <div className="rounded-2xl border border-neutral-200/90 bg-neutral-50 p-3 text-left shadow-sm dark:border-zinc-700/80 dark:bg-zinc-950/40">
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                          <IconFile className="size-3.5 shrink-0 text-neutral-400" aria-hidden />
                          <span>{t("templatePattern")}</span>
                        </div>
                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-[#f8fafc] px-3 py-2 text-xs text-foreground dark:bg-zinc-900/70">
                          {template.pattern}
                        </pre>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                          <IconInfoCircle className="size-3.5 shrink-0 text-neutral-400" aria-hidden />
                          <span>{t("templateExample")}</span>
                        </div>
                        <p className="mt-2 rounded-2xl bg-muted/20 px-3 py-2 text-sm text-foreground dark:bg-zinc-950/60">
                          {template.example}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-1 font-semibold text-foreground dark:bg-accent/15">
                          <IconApps className="size-3.5 shrink-0 text-neutral-500" aria-hidden />
                          {t("policyActionDataMask")}
                        </span>
                      </div>
                      <div className="pt-1">
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          className="w-full sm:w-auto"
                          onClick={() => handleUseTemplate(template)}
                        >
                          {t("templateUse")}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

      </main>
    </AppPageShell>
  );
}