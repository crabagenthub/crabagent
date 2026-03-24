"use client";

import { useTranslations } from "next-intl";
import { TitleHintIcon } from "@/components/message-hint";

type PlaceholderNs = "Overview" | "Logs" | "Analytics" | "Machines" | "Alerts";

export function SectionPlaceholderPage({ ns }: { ns: PlaceholderNs }) {
  const t = useTranslations(ns);

  return (
    <main className="ca-page max-w-2xl">
      <header className="mb-10">
        <h1 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-3xl font-semibold tracking-tight text-neutral-900">
          <span>{t("title")}</span>
          <TitleHintIcon tooltipText={t("subtitle")} />
        </h1>
      </header>
    </main>
  );
}
