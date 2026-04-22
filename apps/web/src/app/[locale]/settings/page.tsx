"use client";

import { useTranslations } from "next-intl";
import { AppPageShell } from "@/components/app-page-shell";
import { CollectorSettingsForm } from "@/components/collector-settings-form";
import { MessageHint } from "@/components/message-hint";

export default function SettingsPage() {
  const t = useTranslations("Settings");

  return (
    <AppPageShell variant="settings">
      <main className="ca-page relative z-[1] max-w-2xl space-y-12">
        <header className="mb-6">
          <h1 className="ca-page-title">{t("title")}</h1>
          <MessageHint
            text={t("subtitle")}
            className="mt-2"
            textClassName="text-base text-ca-muted"
            clampClass="line-clamp-3"
          />
        </header>

        <section>
          <CollectorSettingsForm />
        </section>
      </main>
    </AppPageShell>
  );
}
