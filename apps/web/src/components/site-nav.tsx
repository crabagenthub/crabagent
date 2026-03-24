"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { ComponentType, CSSProperties, ReactNode } from "react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CRABAGENT_COLLECTOR_SETTINGS_EVENT } from "@/components/collector-settings-form";
import { LocalizedLink } from "@/components/localized-link";
import { clearApiKey } from "@/lib/collector";
import {
  NavIconAlerts,
  NavIconAnalytics,
  NavIconLogs,
  NavIconMachines,
  NavIconOverview,
  NavIconSettings,
  NavIconTraces,
} from "@/components/nav-icons";

type NavGlyph = ComponentType<{ className?: string }>;

type NavDef = {
  href: string;
  label: string;
  Icon: NavGlyph;
};

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

function IconGear({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function IconLogout({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

/** Locale switcher shown at the bottom of the user panel only. */
function UserPanelLocale({ onAfterChange }: { onAfterChange?: () => void }) {
  const t = useTranslations("Nav");
  const locale = useLocale() as AppLocale;
  const pathname = usePathname();
  const router = useRouter();

  const pick = (next: AppLocale) => {
    if (next === locale) {
      return;
    }
    router.replace(pathname, { locale: next });
    onAfterChange?.();
  };

  const btn = (code: AppLocale, label: string) => {
    const active = locale === code;
    return (
      <button
        key={code}
        type="button"
        aria-pressed={active}
        aria-label={label}
        onClick={() => pick(code)}
        className={[
          "flex-1 rounded-lg px-3 py-2 text-center text-xs font-semibold transition",
          active
            ? "bg-neutral-900 text-white shadow-sm"
            : "bg-neutral-100/90 text-ca-shell-text ring-1 ring-ca-shell-border hover:bg-white",
        ].join(" ")}
      >
        {code === "en" ? "EN" : "中文"}
      </button>
    );
  };

  return (
    <div className="border-t border-neutral-200/90 px-3 py-3">
      <p className="mb-2 text-[11px] font-semibold text-ca-shell-muted">{t("language")}</p>
      <div className="flex gap-2">
        {btn("en", t("localeEn"))}
        {btn("zh-CN", t("localeZhCN"))}
      </div>
    </div>
  );
}

const STORAGE_KEY_BOTTOM = "crabagent-sidebar-bottom-expanded";

function ChevronUpThin({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 14l6-6 6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronDownThin({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 10l6 6 6-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UserAvatarSilhouette({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="9" r="3.25" fill="currentColor" />
      <path
        d="M6.5 19.25c.85-2.8 3.2-4.5 5.5-4.5s4.65 1.7 5.5 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 双尖角：收起底部用户条（与参考产品一致） */
function UserStripCollapseChevrons({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 7l4-3 4 3M8 17l4 3 4-3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SidebarUserProfile({
  sidebarCollapsed,
  onRequestStripCollapse,
}: {
  sidebarCollapsed: boolean;
  onRequestStripCollapse?: () => void;
}) {
  const t = useTranslations("Nav");
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      return;
    }
    const r = anchorRef.current.getBoundingClientRect();
    const width = Math.min(288, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left, window.innerWidth - width - 12));
    const gap = 10;
    const bottom = window.innerHeight - r.top + gap;
    setPanelStyle({ left, bottom, width });
  }, [open, sidebarCollapsed]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const onLogout = () => {
    clearApiKey();
    window.dispatchEvent(new Event(CRABAGENT_COLLECTOR_SETTINGS_EVENT));
    setOpen(false);
  };

  const avatarFace = (
    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sky-400/90 text-white shadow-sm ring-2 ring-white/80">
      <UserAvatarSilhouette className="h-5 w-5 text-white" />
    </div>
  );

  const panel =
    open &&
    mounted &&
    createPortal(
      <>
        <div
          className="fixed inset-0 z-[60] bg-black/10"
          role="presentation"
          onClick={() => setOpen(false)}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="nav-user-panel-title"
          className="fixed z-[70] max-h-[min(90dvh,32rem)] overflow-y-auto rounded-xl border border-ca-shell-border bg-white pb-0 shadow-xl"
          style={panelStyle}
        >
          <div className="px-3 pt-3">
            <p id="nav-user-panel-title" className="text-[11px] font-semibold text-ca-shell-muted">
              {t("userPopTitle")}
            </p>
            <div className="mt-2 flex gap-3 rounded-xl bg-sky-50/90 px-3 py-2.5 ring-1 ring-sky-100/80">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sky-400/90 text-white shadow-sm">
                <UserAvatarSilhouette className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-sm font-semibold text-ca-shell-text">{t("userDisplayName")}</p>
                <p className="truncate text-[11px] text-ca-shell-muted">{t("userHandle")}</p>
              </div>
            </div>
          </div>
          <div className="mt-2 border-t border-neutral-200/90 px-2 py-1">
            <LocalizedLink
              href="/settings"
              className="flex items-center gap-2.5 rounded-lg px-2 py-2.5 text-sm font-medium text-ca-shell-text no-underline transition hover:bg-ca-shell-sidebar-hover"
              onClick={() => setOpen(false)}
            >
              <IconGear className="h-4 w-4 shrink-0 text-neutral-500" />
              {t("userAccountSettings")}
            </LocalizedLink>
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2.5 text-left text-sm font-medium text-ca-shell-text transition hover:bg-ca-shell-sidebar-hover"
              onClick={onLogout}
            >
              <IconLogout className="h-4 w-4 shrink-0 text-neutral-500" />
              {t("userLogout")}
            </button>
          </div>
          <UserPanelLocale onAfterChange={() => setOpen(false)} />
        </div>
      </>,
      document.body,
    );

  const collapseBtn =
    onRequestStripCollapse != null ? (
      <button
        type="button"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ca-shell-muted transition hover:bg-white/90 hover:text-ca-shell-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ca-accent/40"
        aria-label={t("collapseBottom")}
        title={t("collapseBottom")}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRequestStripCollapse();
        }}
      >
        <UserStripCollapseChevrons className="text-current" />
      </button>
    ) : null;

  const openMenu = () => setOpen((o) => !o);

  return (
    <>
      <div className={[sidebarCollapsed ? "px-2 pb-2 pt-1" : "px-3 pb-3 pt-2"].join(" ")}>
        <div
          className={["flex min-w-0 items-center gap-2", sidebarCollapsed ? "flex-col justify-center gap-1" : ""].join(
            " ",
          )}
        >
          {sidebarCollapsed ? (
            <>
              <button
                ref={anchorRef}
                type="button"
                className={[
                  "flex flex-col items-center rounded-xl p-1.5 outline-none ring-offset-2 ring-offset-ca-shell-sidebar transition",
                  "hover:bg-white/60 focus-visible:ring-2 focus-visible:ring-ca-accent/45",
                ].join(" ")}
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-label={t("userMenuOpen")}
                title={`${t("userDisplayName")} · ${t("userHandle")}`}
                onClick={openMenu}
              >
                {avatarFace}
              </button>
              {collapseBtn}
            </>
          ) : (
            <>
              <button
                ref={anchorRef}
                type="button"
                className={[
                  "flex min-w-0 flex-1 items-center gap-3 rounded-xl py-1.5 pl-1 pr-2 text-left outline-none ring-offset-2 ring-offset-ca-shell-sidebar transition",
                  "hover:bg-white/60 focus-visible:ring-2 focus-visible:ring-ca-accent/45",
                ].join(" ")}
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-label={t("userMenuOpen")}
                onClick={openMenu}
              >
                {avatarFace}
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="truncate text-sm font-semibold text-ca-shell-text">{t("userDisplayName")}</p>
                  <p className="truncate text-[11px] text-ca-shell-muted">{t("userHandle")}</p>
                </div>
              </button>
              {collapseBtn}
            </>
          )}
        </div>
      </div>
      {panel}
    </>
  );
}

function NavSectionLabel({ children, first }: { children: ReactNode; first?: boolean }) {
  return (
    <p
      className={[
        "px-3 text-[11px] font-semibold text-ca-shell-muted",
        first ? "pb-1 pt-0.5" : "mt-3 border-t border-ca-shell-border/80 pb-1 pt-3",
      ].join(" ")}
    >
      {children}
    </p>
  );
}

export function SiteNav() {
  const t = useTranslations("Nav");
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [bottomExpanded, setBottomExpanded] = useState(true);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === "1") {
        setCollapsed(true);
      }
      const rawBottom = window.localStorage.getItem(STORAGE_KEY_BOTTOM);
      if (rawBottom === "0") {
        setBottomExpanded(false);
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

  const toggleBottomExpanded = useCallback(() => {
    setBottomExpanded((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(STORAGE_KEY_BOTTOM, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const closeBottomStrip = useCallback(() => {
    setBottomExpanded(false);
    try {
      window.localStorage.setItem(STORAGE_KEY_BOTTOM, "0");
    } catch {
      // ignore
    }
  }, []);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" || pathname === "" : pathname === href || pathname.startsWith(`${href}/`);

  const workspaceItems: NavDef[] = useMemo(
    () => [{ href: "/overview", label: t("overview"), Icon: NavIconOverview }],
    [t],
  );

  const observeItems: NavDef[] = useMemo(
    () => [
      { href: "/traces", label: t("traces"), Icon: NavIconTraces },
      { href: "/logs", label: t("logs"), Icon: NavIconLogs },
      { href: "/analytics", label: t("analytics"), Icon: NavIconAnalytics },
    ],
    [t],
  );

  const opsItems: NavDef[] = useMemo(
    () => [
      { href: "/machines", label: t("machines"), Icon: NavIconMachines },
      { href: "/alerts", label: t("alerts"), Icon: NavIconAlerts },
    ],
    [t],
  );

  const settingsItems: NavDef[] = useMemo(
    () => [{ href: "/settings", label: t("settings"), Icon: NavIconSettings }],
    [t],
  );

  const navLinkRow = (it: NavDef) => {
    const active = isActive(it.href);

    if (collapsed) {
      return (
        <LocalizedLink
          key={it.href}
          href={it.href}
          title={it.label}
          className={[
            "flex items-center justify-center rounded-xl px-2 py-2 text-sm transition",
            active
              ? "bg-white text-ca-shell-text shadow-sm ring-1 ring-ca-shell-border"
              : "text-ca-shell-text hover:bg-ca-shell-sidebar-hover",
          ].join(" ")}
        >
          <span
            className={[
              "grid h-8 w-8 place-items-center rounded-lg",
              active ? "bg-neutral-200/70 text-neutral-800" : "bg-white/70 text-ca-shell-text",
            ].join(" ")}
          >
            <it.Icon className="h-[18px] w-[18px]" />
          </span>
        </LocalizedLink>
      );
    }

    return (
      <LocalizedLink
        key={it.href}
        href={it.href}
        className={[
          "flex min-w-0 items-center gap-3 rounded-xl py-2 pl-3 pr-3 text-sm font-medium transition",
          active
            ? "bg-white text-ca-shell-text shadow-sm ring-1 ring-ca-shell-border"
            : "text-ca-shell-text hover:bg-ca-shell-sidebar-hover",
        ].join(" ")}
      >
        <span
          className={[
            "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
            active ? "bg-neutral-200/70 text-neutral-800" : "bg-white/80 text-ca-shell-text",
          ].join(" ")}
        >
          <it.Icon className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1 truncate">{it.label}</span>
      </LocalizedLink>
    );
  };

  const groups: { title: string; items: NavDef[] }[] = useMemo(
    () => [
      { title: t("groupMain"), items: workspaceItems },
      { title: t("groupObserve"), items: observeItems },
      { title: t("groupOps"), items: opsItems },
    ],
    [t, workspaceItems, observeItems, opsItems],
  );

  return (
    <aside
      className={[
        "flex h-full min-h-0 shrink-0 flex-col border-r border-ca-shell-border bg-ca-shell-sidebar transition-[width] duration-200 ease-out",
        collapsed ? "w-[72px]" : "w-[272px]",
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

      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-3">
        {groups.map((g, idx) => (
          <Fragment key={g.title}>
            {!collapsed ? <NavSectionLabel first={idx === 0}>{g.title}</NavSectionLabel> : null}
            {g.items.map((it) => navLinkRow(it))}
          </Fragment>
        ))}

        {!collapsed ? <NavSectionLabel>{t("groupSettings")}</NavSectionLabel> : null}
        {settingsItems.map((it) => navLinkRow(it))}
      </nav>

      <div className="relative z-20 isolate shrink-0 border-t border-ca-shell-border bg-ca-shell-sidebar">
        <button
          type="button"
          className="absolute left-1/2 top-0 z-30 flex h-7 min-w-[2.25rem] -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md border border-ca-shell-border bg-white px-2 text-ca-shell-muted shadow-sm transition hover:bg-neutral-50 hover:text-ca-shell-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ca-accent/40 pointer-events-auto"
          aria-expanded={bottomExpanded}
          aria-label={bottomExpanded ? t("collapseBottom") : t("expandBottom")}
          onClick={(e) => {
            e.stopPropagation();
            toggleBottomExpanded();
          }}
        >
          {bottomExpanded ? <ChevronUpThin className="h-4 w-4" /> : <ChevronDownThin className="h-4 w-4" />}
        </button>
        {bottomExpanded ? (
          <div className="pointer-events-auto pt-3">
            <SidebarUserProfile sidebarCollapsed={collapsed} onRequestStripCollapse={closeBottomStrip} />
          </div>
        ) : (
          <div className="h-6 shrink-0" aria-hidden />
        )}
      </div>
    </aside>
  );
}
