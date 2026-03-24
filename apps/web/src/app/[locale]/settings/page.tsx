"use client";

import { useTranslations } from "next-intl";
import { CollectorSettingsForm } from "@/components/collector-settings-form";
import { MessageHint, TitleHintIcon } from "@/components/message-hint";

export default function SettingsPage() {
  const t = useTranslations("Settings");

  return (
    <main className="ca-page max-w-2xl">
      <header className="mb-10">
        <h1 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-3xl font-semibold tracking-tight text-neutral-900">
          <span>{t("title")}</span>
          <TitleHintIcon tooltipText={t("subtitle")} />
        </h1>
        <MessageHint
          text={t("subtitle")}
          className="mt-2"
          textClassName="text-base text-ca-muted"
          clampClass="line-clamp-3"
        />
      </header>
      <CollectorSettingsForm />
    </main>
  );
}
