"use client";

import "@/lib/arco-react19-setup";
import {
  IconMenuFold,
  IconMenuUnfold,
  IconSettings,
  IconExport,
  IconUp,
  IconDown,
  IconUser,
  IconCaretUp,
  IconCaretDown,
  IconSun,
  IconMoon,
  IconDesktop,
} from "@arco-design/web-react/icon";
import { Popover } from "@arco-design/web-react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { ComponentType, ReactNode } from "react";
import { Fragment, useCallback, useLayoutEffect, useMemo, useState } from "react";
import { CRABAGENT_COLLECTOR_SETTINGS_EVENT } from "@/components/collector-settings-form";
import { LocalizedLink } from "@/components/localized-link";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AppLocale } from "@/i18n/routing";
import { clearApiKey } from "@/lib/collector";
import {
  readSidebarBottomExpanded,
  readSidebarCollapsed,
  SIDEBAR_BOTTOM_EXPANDED_STORAGE_KEY,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
} from "@/lib/sidebar-storage";
import type { ThemePreference } from "@/lib/theme-storage";
import {
  NavIconAlerts,
  NavIconAnalytics,
  NavIconCommandExec,
  NavIconDataSecurity,
  NavIconLogs,
  NavIconMetrics,
  NavIconOptimization,
  NavIconOverview,
  NavIconSettings,
  NavIconResourceAudit,
  NavIconTraces,
} from "@/components/nav-icons";

type NavGlyph = ComponentType<{ className?: string }>;

type NavDef = {
  href: string;
  label: string;
  Icon: NavGlyph;
};

const CLAWD_LOGO_URL = "https://clawhub.ai/clawd-logo.png";

/** 折叠按钮：方框 + 竖线（侧栏收拢 / 展开） */
function SidebarRailIcon({ collapsed }: { collapsed: boolean }) {
  return collapsed ? (
    <IconMenuUnfold className="shrink-0 text-sidebar-foreground" />
  ) : (
    <IconMenuFold className="shrink-0 text-sidebar-foreground" />
  );
}

function IconGear({ className }: { className?: string }) {
  return <IconSettings className={className} />;
}

function IconLogout({ className }: { className?: string }) {
  return <IconExport className={className} />;
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
      <Button
        key={code}
        type="button"
        aria-pressed={active}
        aria-label={label}
        onClick={() => pick(code)}
        variant={active ? "default" : "secondary"}
        size="sm"
        className="flex-1 text-center text-xs"
      >
        {code === "en" ? "EN" : "中文"}
      </Button>
    );
  };

  return (
    <div className="border-t border-border px-3 py-3">
      <p className="mb-2 text-[11px] font-semibold text-muted-foreground">{t("language")}</p>
      <div className="flex gap-2">
        {btn("en", t("localeEn"))}
        {btn("zh-CN", t("localeZhCN"))}
      </div>
    </div>
  );
}

function UserPanelTheme({ onAfterChange }: { onAfterChange?: () => void }) {
  const t = useTranslations("Nav");
  const { preference, setPreference } = useTheme();

  const row = (pref: ThemePreference, label: string, Icon: NavGlyph) => {
    const active = preference === pref;
    return (
      <Button
        key={pref}
        type="button"
        aria-pressed={active}
        variant={active ? "default" : "secondary"}
        size="sm"
        className="flex flex-1 flex-col items-center gap-1 py-2 text-center text-[11px] leading-tight"
        onClick={() => {
          setPreference(pref);
          onAfterChange?.();
        }}
      >
        <Icon className="size-4 shrink-0" />
        <span className="line-clamp-2 w-full px-0.5">{label}</span>
      </Button>
    );
  };

  return (
    <div className="border-t border-border px-3 py-3">
      <p className="mb-2 text-[11px] font-semibold text-muted-foreground">{t("themeAppearance")}</p>
      <div className="flex gap-2">
        {row("light", t("themeLight"), IconSun)}
        {row("dark", t("themeDark"), IconMoon)}
        {row("system", t("themeSystem"), IconDesktop)}
      </div>
    </div>
  );
}

function ChevronUpThin({ className }: { className?: string }) {
  return <IconUp className={className} />;
}

function ChevronDownThin({ className }: { className?: string }) {
  return <IconDown className={className} />;
}

function UserAvatarSilhouette({ className }: { className?: string }) {
  return <IconUser className={className} />;
}

/** 双尖角：收起底部用户条（与参考产品一致） */
function UserStripCollapseChevrons({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col -space-y-1.5", className)}>
      <IconCaretUp className="size-3" />
      <IconCaretDown className="size-3" />
    </div>
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

  const onLogout = () => {
    clearApiKey();
    window.dispatchEvent(new Event(CRABAGENT_COLLECTOR_SETTINGS_EVENT));
    setOpen(false);
  };

  const avatarFace = (
    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm ring-2 ring-background">
      <UserAvatarSilhouette className="h-5 w-5 text-primary-foreground" />
    </div>
  );

  const userMenuPanel = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="nav-user-panel-title"
      className="w-[min(100vw-1.5rem,18rem)] border-0 bg-popover pb-0 text-popover-foreground"
    >
      <div className="px-3 pt-3">
        <p id="nav-user-panel-title" className="text-[11px] font-semibold text-muted-foreground">
          {t("userPopTitle")}
        </p>
        <div className="mt-2 flex gap-3 rounded-xl bg-primary/10 px-3 py-2.5 ring-1 ring-primary/20">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm">
            <UserAvatarSilhouette className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-semibold text-popover-foreground">{t("userDisplayName")}</p>
            <p className="truncate text-[11px] text-muted-foreground">{t("userHandle")}</p>
          </div>
        </div>
      </div>
      <div className="mt-2 border-t border-border px-2 py-1">
        <LocalizedLink
          href="/settings"
          className="flex items-center gap-2.5 rounded-lg px-2 py-2.5 text-sm font-medium text-popover-foreground no-underline transition hover:bg-accent hover:text-accent-foreground"
          onClick={() => setOpen(false)}
        >
          <IconGear className="h-4 w-4 shrink-0 text-muted-foreground" />
          {t("userAccountSettings")}
        </LocalizedLink>
        <Button
          type="button"
          variant="ghost"
          className="flex w-full items-center justify-start gap-2.5 px-2 py-2.5 text-left text-sm font-medium text-popover-foreground"
          onClick={onLogout}
        >
          <IconLogout className="h-4 w-4 shrink-0 text-muted-foreground" />
          {t("userLogout")}
        </Button>
      </div>
      <UserPanelTheme onAfterChange={() => setOpen(false)} />
      <UserPanelLocale onAfterChange={() => setOpen(false)} />
    </div>
  );

  const collapseBtn =
    onRequestStripCollapse != null ? (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring"
        aria-label={t("collapseBottom")}
        title={t("collapseBottom")}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRequestStripCollapse();
        }}
      >
        <UserStripCollapseChevrons className="text-current" />
      </Button>
    ) : null;

  const triggerBtn = (
    <Button
      type="button"
      variant="ghost"
      size={sidebarCollapsed ? "icon" : "sm"}
      className={[
        "ring-offset-2 ring-offset-sidebar transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        sidebarCollapsed
          ? "h-auto w-auto flex-col items-center rounded-full p-1"
          : "h-auto min-w-0 w-full flex-row items-center gap-2.5 rounded-lg py-1.5 pl-1 pr-2 text-left",
      ].join(" ")}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={t("userMenuOpen")}
      title={sidebarCollapsed ? `${t("userDisplayName")} · ${t("userHandle")}` : undefined}
    >
      {avatarFace}
      {!sidebarCollapsed ? (
        <div className="min-w-0 flex-1 text-left leading-tight">
          <p className="truncate text-sm font-semibold text-sidebar-foreground">{t("userDisplayName")}</p>
          <p className="truncate text-[11px] text-muted-foreground">{t("userHandle")}</p>
        </div>
      ) : null}
    </Button>
  );

  return (
    <div className={[sidebarCollapsed ? "px-2 pb-1.5 pt-1" : "px-2.5 pb-2.5 pt-1.5"].join(" ")}>
      <div
        className={cn(
          "flex min-w-0 items-center gap-2",
          sidebarCollapsed ? "flex-col justify-center gap-1" : "flex-row",
        )}
      >
        <div className={cn(!sidebarCollapsed && "min-w-0 flex-1")}>
          <Popover
            className="site-nav-user-popover"
            trigger="click"
            position="top"
            blurToHide={false}
            escToClose
            popupVisible={open}
            onVisibleChange={setOpen}
            style={{ maxWidth: 288 }}
            triggerProps={{
              showArrow: false,
              duration: { enter: 180, exit: 140, appear: 180 },
              /** 避免 Arco 将触发器包成块级导致头像与文案上下叠放 */
              className: sidebarCollapsed ? undefined : "flex w-full min-w-0 flex-row items-stretch",
            }}
            content={userMenuPanel}
          >
            {triggerBtn}
          </Popover>
        </div>
        {collapseBtn}
      </div>
    </div>
  );
}

function NavSectionLabel({ children, first }: { children: ReactNode; first?: boolean }) {
  return (
    <p
      className={[
        "px-2.5 text-[11px] font-medium text-[color:var(--sidebar-section-label)]",
        first ? "pb-0.5 pt-0" : "mt-2 border-0 pb-0.5 pt-2",
      ].join(" ")}
    >
      {children}
    </p>
  );
}

export function SiteNav() {
  const t = useTranslations("Nav");
  const pathname = usePathname();
  
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
  const [bottomExpanded, setBottomExpanded] = useState(readSidebarBottomExpanded);

  useLayoutEffect(() => {
    document.documentElement.dataset.sidebarCollapsed = collapsed ? "1" : "0";
  }, [collapsed]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      document.documentElement.dataset.sidebarCollapsed = next ? "1" : "0";
      return next;
    });
  }, []);

  const toggleBottomExpanded = useCallback(() => {
    setBottomExpanded((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(SIDEBAR_BOTTOM_EXPANDED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const closeBottomStrip = useCallback(() => {
    setBottomExpanded(false);
    try {
      window.localStorage.setItem(SIDEBAR_BOTTOM_EXPANDED_STORAGE_KEY, "0");
    } catch {
      // ignore
    }
  }, []);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" || pathname === "" : pathname === href || pathname.startsWith(`${href}/`);

  const observeItems: NavDef[] = useMemo(
    () => [
      { href: "/traces", label: t("traces"), Icon: NavIconTraces },
      { href: "/command-analysis", label: t("commandAnalysis"), Icon: NavIconCommandExec },
      { href: "/observe/overview", label: t("metrics"), Icon: NavIconMetrics },
    ],
    [t],
  );

  const auditItems: NavDef[] = useMemo(
    () => [
      { href: "/resource-audit", label: t("resourceAudit"), Icon: NavIconResourceAudit },
      { href: "/data-security-audit", label: t("dataSecurityAudit"), Icon: NavIconDataSecurity },
    ],
    [t],
  );

  const securityItems: NavDef[] = useMemo(
    () => [{ href: "/data-security", label: t("dataSecurity"), Icon: NavIconDataSecurity }],
    [t],
  );

  const settingsItems: NavDef[] = useMemo(
    () => [
      { href: "/settings", label: t("settings"), Icon: NavIconSettings },
      { href: "/alerts", label: t("alerts"), Icon: NavIconAlerts },
    ],
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
            "group mx-auto flex w-full max-w-[2.75rem] items-center justify-center rounded-lg border-0 px-1.5 py-1.5 text-sm shadow-none ring-0 transition",
            active
              ? "bg-sidebar-active text-sidebar-active-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          ].join(" ")}
        >
          <span className="grid h-7 w-7 place-items-center border-0 ring-0 text-current">
            <it.Icon className="h-[17px] w-[17px] transition-transform duration-200 ease-out motion-reduce:transition-none group-hover:scale-110 motion-reduce:group-hover:scale-100" />
          </span>
        </LocalizedLink>
      );
    }

    return (
      <LocalizedLink
        key={it.href}
        href={it.href}
        className={[
          "group flex min-w-0 items-center gap-2.5 rounded-lg py-1.5 pl-2.5 pr-3 text-sm font-medium transition",
          active
            ? "bg-sidebar-active text-sidebar-active-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        ].join(" ")}
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center text-current">
          <it.Icon className="h-[17px] w-[17px] transition-transform duration-200 ease-out motion-reduce:transition-none group-hover:scale-110 motion-reduce:group-hover:scale-100" />
        </span>
        <span className="min-w-0 flex-1 truncate">{it.label}</span>
      </LocalizedLink>
    );
  };

  const groups: { title: string; items: NavDef[] }[] = useMemo(
    () => [
      { title: t("groupObserve"), items: observeItems },
      { title: t("groupAudit"), items: auditItems },
      { title: t("groupSecurity"), items: securityItems },
      { title: t("groupSettings"), items: settingsItems },
    ],
    [t, observeItems, auditItems, settingsItems, securityItems],
  );

  return (
    <aside
      className={[
        "flex h-full min-h-0 shrink-0 flex-col border-r-[0.5px] border-r-[rgb(228,231,235)] bg-sidebar transition-[width] duration-200 ease-out",
        collapsed ? "w-[72px]" : "w-[272px]",
      ].join(" ")}
    >
      <div
        className={[
          "flex shrink-0 items-center border-0",
          collapsed ? "justify-between gap-1 px-1.5 py-2.5 pb-4" : "justify-between gap-2 px-3 py-3 pb-5",
        ].join(" ")}
      >
        {collapsed ? (
          <div className="relative h-7 w-7 shrink-0 overflow-hidden rounded-md border-0 bg-sidebar ring-0">
            <Image
              src={CLAWD_LOGO_URL}
              alt={t("brand")}
              width={56}
              height={56}
              className="h-full w-full object-contain p-px"
              sizes="28px"
              priority
            />
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2.5 pr-1">
            <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-sidebar ring-1 ring-sidebar-border">
              <Image
                src={CLAWD_LOGO_URL}
                alt=""
                width={72}
                height={72}
                className="h-full w-full object-contain p-0.5"
                sizes="36px"
                priority
              />
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-semibold text-sidebar-foreground">{t("tagline")}</p>
              <p className="truncate text-[11px] text-muted-foreground">{t("brand")}</p>
            </div>
          </div>
        )}

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={[
            "shrink-0 bg-sidebar text-sidebar-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            collapsed ? "h-7 w-7 border-0 ring-0" : "h-8 w-8 border border-sidebar-border",
          ].join(" ")}
          aria-label={collapsed ? t("expandSidebar") : t("collapseSidebar")}
          title={collapsed ? t("expandSidebar") : t("collapseSidebar")}
          onClick={toggleCollapsed}
        >
          <SidebarRailIcon collapsed={collapsed} />
        </Button>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2.5 py-2">
        {groups.map((g, idx) => (
          <Fragment key={g.title}>
            {!collapsed ? <NavSectionLabel first={idx === 0}>{g.title}</NavSectionLabel> : null}
            {g.items.map((it) => navLinkRow(it))}
          </Fragment>
        ))}
      </nav>

      <div className="relative z-20 isolate shrink-0 border-0 bg-sidebar">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute left-1/2 top-0 z-30 h-7 min-w-[2.25rem] -translate-x-1/2 -translate-y-1/2 border border-sidebar-border bg-sidebar px-2 text-muted-foreground shadow-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring pointer-events-auto"
          aria-expanded={bottomExpanded}
          aria-label={bottomExpanded ? t("collapseBottom") : t("expandBottom")}
          onClick={(e) => {
            e.stopPropagation();
            toggleBottomExpanded();
          }}
        >
          {bottomExpanded ? <ChevronUpThin className="h-4 w-4" /> : <ChevronDownThin className="h-4 w-4" />}
        </Button>
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
