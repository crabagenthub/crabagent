"use client";

import { useTranslations } from "next-intl";
import { AppPageShell, type AppPageShellVariant } from "@/components/app-page-shell";
import { ListEmptyState } from "@/components/list-empty-state";

type PlaceholderNs = "Overview" | "Logs" | "Analytics" | "Machines" | "Alerts";

export function SectionPlaceholderPage({ ns, variant }: { ns: PlaceholderNs; variant: AppPageShellVariant }) {
  const t = useTranslations(ns);

  return (
    <AppPageShell variant={variant}>
      <main className="ca-page relative z-[1]">
        <header className="mb-6">
          <h1 className="ca-page-title">{t("title")}</h1>
        </header>
        <ListEmptyState variant="card" title={t("listEmptyTitle")} description={t("subtitle")} />
      </main>
    </AppPageShell>
  );
}
