"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LocalizedLink } from "@/components/localized-link";

const STORAGE_KEY = "crabagent-sidebar-collapsed";

/** 折叠按钮：方框 + 竖线（侧栏收拢 / 展开） */
function SidebarRailIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      className="shrink-0 text-ca-shell-text"
      aria-hidden
    >
      <rect
        x="4.25"
        y="5.25"
        width="15.5"
        height="13.5"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {collapsed ? (
        <path d="M9 5v14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      ) : (
        <path d="M15 5v14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      )}
    </svg>
  );
}

type AppLocale = "en" | "zh-CN";

function LocaleSwitcher({ collapsed }: { collapsed: boolean }) {
  const t = useTranslations("Nav");
  const locale = useLocale() as AppLocale;
  const pathname = usePathname();
  const router = useRouter();

  const setLocale = (next: AppLocale) => {
    if (next === locale) {
      return;
    }
    router.replace(pathname, { locale: next });
  };

  const btn = (code: AppLocale, label: string) => {
    const active = locale === code;
    return (
      <button
        key={code}
        type="button"
        aria-pressed={active}
        aria-label={label}
        title={label}
        onClick={() => setLocale(code)}
        className={[
          "rounded-md px-2 py-1 text-[11px] font-semibold transition",
          collapsed ? "min-w-[2.25rem]" : "",
          active
            ? "bg-neutral-900 text-white shadow-sm"
            : "bg-white/60 text-ca-shell-text ring-1 ring-ca-shell-border hover:bg-white",
        ].join(" ")}
      >
        {code === "en" ? "EN" : "中文"}
      </button>
    );
  };

  return (
    <div
      className={[
        "border-t border-ca-shell-border",
        collapsed ? "p-2" : "space-y-1.5 p-3 pt-2",
      ].join(" ")}
    >
      {!collapsed ? (
        <p className="px-0.5 text-[11px] font-semibold uppercase tracking-wide text-ca-shell-muted">
          {t("language")}
        </p>
      ) : null}
      <div className={["flex gap-1", collapsed ? "flex-col items-stretch" : "flex-row flex-wrap"].join(" ")}>
        {btn("en", t("localeEn"))}
        {btn("zh-CN", t("localeZhCN"))}
      </div>
    </div>
  );
}

export function SiteNav() {
  const t = useTranslations("Nav");
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === "1") {
        setCollapsed(true);
      }
    } catch {
      // ignore
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const navItem = (href: string, label: string) => {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <LocalizedLink
        href={href}
        title={collapsed ? label : undefined}
        className={[
          "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
          collapsed ? "justify-center px-2" : "",
          active
            ? "bg-white text-ca-shell-text shadow-sm ring-1 ring-ca-shell-border"
            : "text-ca-shell-text hover:bg-ca-shell-sidebar-hover",
        ].join(" ")}
      >
        <span
          className={[
            "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-semibold",
            active ? "bg-neutral-900 text-white" : "bg-white/70 text-ca-shell-text",
          ].join(" ")}
        >
          {label.slice(0, 1)}
        </span>
        {collapsed ? null : <span className="min-w-0 truncate">{label}</span>}
      </LocalizedLink>
    );
  };

  const mainItems = useMemo(
    () => [
      { href: "/", label: t("home") },
      { href: "/traces", label: t("traces") },
    ],
    [t],
  );

  const settingsItems = useMemo(() => [{ href: "/settings", label: t("settings") }], [t]);

  return (
    <aside
      className={[
        "flex h-full min-h-0 shrink-0 flex-col border-r border-ca-shell-border bg-ca-shell-sidebar transition-[width] duration-200 ease-out",
        collapsed ? "w-[72px]" : "w-[260px]",
      ].join(" ")}
    >
      <div
        className={[
          "flex h-14 items-center border-b border-ca-shell-border px-4",
          collapsed ? "justify-center gap-2" : "justify-between gap-2",
        ].join(" ")}
      >
        {collapsed ? (
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-neutral-900 text-xs font-bold text-white shadow-sm">
            C
          </div>
        ) : (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ca-shell-text">{t("brand")}</p>
            <p className="truncate text-[11px] text-ca-shell-muted">{t("tagline")}</p>
          </div>
        )}

        <button
          type="button"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ca-shell-border bg-white/50 text-ca-shell-text transition hover:bg-white/90"
          aria-label={collapsed ? t("expandSidebar") : t("collapseSidebar")}
          title={collapsed ? t("expandSidebar") : t("collapseSidebar")}
          onClick={toggleCollapsed}
        >
          <SidebarRailIcon collapsed={collapsed} />
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        {!collapsed ? (
          <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ca-shell-muted">
            {t("groupMain")}
          </p>
        ) : null}
        {mainItems.map((it) => (
          <div key={it.href}>{navItem(it.href, it.label)}</div>
        ))}

        {!collapsed ? (
          <p className="mt-3 px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ca-shell-muted">
            {t("groupSettings")}
          </p>
        ) : null}
        {settingsItems.map((it) => (
          <div key={it.href}>{navItem(it.href, it.label)}</div>
        ))}
      </nav>

      <LocaleSwitcher collapsed={collapsed} />

      <div className="border-t border-ca-shell-border p-3 text-[11px] text-ca-shell-muted">
        {collapsed ? null : t("footer")}
      </div>
    </aside>
  );
}
