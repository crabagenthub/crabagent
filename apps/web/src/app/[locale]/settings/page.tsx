"use client";

import { useTranslations } from "next-intl";
import { CollectorSettingsForm } from "@/components/collector-settings-form";

export default function SettingsPage() {
  const t = useTranslations("Settings");

  return (
    <main className="ca-page max-w-2xl">
      <header className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">{t("title")}</h1>
        <p className="mt-2 text-base text-ca-muted">{t("subtitle")}</p>
      </header>
      <CollectorSettingsForm />
    </main>
  );
}
