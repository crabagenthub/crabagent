"use client";

import "@/lib/arco-react19-setup";
import {
  IconMenuFold,
  IconMenuUnfold,
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
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
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
import { readWorkspaceName, saveWorkspaceName, WORKSPACE_FILTER_EVENT, WORKSPACE_OPTIONS, type WorkspaceName } from "@/lib/workspace-filter";
import {
  NavIconAlerts,
  NavIconAnalytics,
  NavIconCommandExec,
  NavIconDataSecurity,
  NavIconLogs,
  NavIconMetrics,
  NavIconOptimization,
  NavIconOverview,
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

function OpenclawWorkspaceIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1146 1024" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
      <path
        d="M386.406135 77.128551l8.642457 9.084932L402.643724 93.366141c14.500168-0.499306 27.092418-2.76445 41.125756-6.137809 29.300731-6.714243 57.785522-7.436816 87.760113-7.306915l15.22274 0.004059c31.05439 0.312574 59.137302 2.403163 89.038823 11.171462 12.072648 2.63049 19.006099 2.074352 30.713401-1.790195 8.764239-5.971374 8.764239-5.971374 17.000757-13.448783 24.202127-19.464811 48.57475-33.453494 80.424782-30.697164 12.299974 1.802372 15.287691 2.602074 24.356384 11.670768-1.522274 10.655918-1.522274 10.655918-4.059397 20.296987l-7.737212-0.568315c-37.115071-1.566927-57.39988 9.917108-85.628929 33.043495l11.609877 6.421966c90.528622 51.371674 154.74423 128.622008 185.031394 228.909421L889.771416 353.167576l9.657307-0.426236c32.913594-0.852473 53.096918 0.462771 78.890329 22.245498 17.252439 20.702927 19.038574 40.1515 18.518971 66.391445-3.397716 29.637661-14.073931 57.042653-36.790319 76.953997-14.487989 10.891363-23.625693 14.008981-41.860506 13.956208l-10.91166 0.032475C897.890211 531.781063 897.890211 531.781063 889.771416 527.721666l-1.380195 7.944241c-19.793622 94.563663-82.243392 189.362771-162.867084 242.971174C673.778998 811.879486 673.778998 811.879486 654.326365 811.879486v81.187949h-81.187949v-77.128552l-12.178192 4.059398c-8.703348 0.385643-17.418874 0.527722-26.1344 0.507425l-13.935912 0.032475C508.188058 819.998281 508.188058 819.998281 491.950468 815.938883v77.128552H410.762519v-81.187949l-20.296987-4.059397c-94.778811-42.075654-161.170256-129.628738-199.925323-223.352106-6.990282-18.449961-11.638292-37.374872-15.222741-56.746317l-8.118795 4.059397c-20.114314 2.208312-36.010915 2.2895-54.29444-6.852262-25.545788-22.50124-40.338232-48.578809-44.718322-82.59656C67.268487 416.327741 69.582343 394.378579 86.010725 373.464564c22.001934-17.877586 38.239524-20.853125 65.965208-20.55273l13.257992 0.113664L175.317468 353.167576l4.185239-12.210667C199.328804 284.746433 224.789345 235.753565 264.624212 190.791679l7.120183-8.281171C299.307703 152.633343 337.303663 126.572012 374.227942 109.603731c-24.25084-19.034515-41.795556-31.947458-73.069153-32.47518l-12.178193-0.255742L280.861802 77.128551c-2.537123-9.641069-2.537123-9.641069-4.059398-20.296987 31.683597-31.683597 80.70894 0.101485 109.603731 20.296987z"
        fill="#CC3434"
      />
      <path
        d="M666.504557 235.445051c16.602935 7.335331 27.043706 17.008875 36.534577 32.475179 2.549302 20.402531 0.13396 32.296566-12.178192 48.71277-11.175521 13.038785-20.418769 15.709868-37.549426 18.015605-20.029067-2.338213-30.640332-11.041561-43.638523-26.1344-5.013356-15.044127-5.906423-24.754206-4.059397-40.593975 16.57452-25.805589 29.804096-34.586066 60.890961-32.475179z"
        fill="#0A0A12"
      />
      <path
        d="M442.636908 245.118595c11.756015 12.425816 16.460857 20.365997 19.119762 37.516951C458.501033 302.218079 450.382238 316.0931 435.118904 328.811192c-15.044127 5.013356-24.754206 5.906423-40.593974 4.059397-14.394623-7.708796-25.687867-16.870856-31.379143-32.491417C360.425991 283.557029 361.619454 270.396463 370.168545 255.742038c7.241965-8.69117 13.055022-14.759969 23.341535-19.53788 18.449961-1.534452 33.977156-2.399104 49.126828 8.914437z"
        fill="#090A12"
      />
      <path
        d="M762.407822 45.923963l9.547702 0.966137C780.167685 48.712769 780.167685 48.712769 788.28648 56.831564c-1.522274 10.655918-1.522274 10.655918-4.059397 20.296987l-7.737212-0.568315c-44.551887-1.879501-66.736494 16.659767-99.374049 45.522082-10.838591 7.984835-17.682735 10.473245-30.908252 11.877797-3.30029-8.881962-3.30029-8.881962-4.059397-20.296987 8.118795-9.896811 8.118795-9.896811 20.296987-20.296987l6.405729-5.979493c26.235886-23.966682 56.782851-45.587033 93.556933-41.466744z"
        fill="#FE4C4C"
      />
      <path
        d="M386.406135 77.128551c14.114525 10.156612 28.277762 20.987085 36.534577 36.534577-1.270591 11.163343-1.270591 11.163343-4.059398 20.296987-18.770654-1.997224-27.896179-9.214832-41.864566-21.567578C344.561866 85.141802 323.729038 73.966281 280.861802 77.128551c-2.537123-9.641069-2.537123-9.641069-4.059398-20.296987 32.00023-32.00023 80.278644 0.621088 109.603731 20.296987z"
        fill="#FE4D4D"
      />
      <path
        d="M678.68275 259.801436c5.370583 21.965399 5.370583 21.965399-0.255742 32.223496-11.561164 6.340779-19.777384 3.292171-32.219438 0.251683-5.370583-21.965399-5.370583-21.965399 0.255742-32.223497 11.561164-6.340779 19.777384-3.292171 32.219438-0.251682zM435.118904 259.801436c5.370583 21.965399 5.370583 21.965399-0.255742 32.223496C423.306057 298.365711 415.089837 295.317104 402.643724 292.276615c-5.370583-21.965399-5.370583-21.965399 0.255742-32.223497C414.456571 253.712339 422.672791 256.765006 435.118904 259.801436z"
        fill="#00DAC2"
      />
    </svg>
  );
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

function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const t = useTranslations("Nav");
  const [open, setOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState<WorkspaceName>(() => readWorkspaceName());

  useEffect(() => {
    const onChanged = () => setWorkspaceName(readWorkspaceName());
    window.addEventListener(WORKSPACE_FILTER_EVENT, onChanged);
    return () => window.removeEventListener(WORKSPACE_FILTER_EVENT, onChanged);
  }, []);

  const current = WORKSPACE_OPTIONS.find((x) => x.value === workspaceName) ?? WORKSPACE_OPTIONS[0]!;

  if (collapsed) {
    return null;
  }

  return (
    <div className="px-2.5 pb-1">
      <Popover
        trigger="click"
        position="bottom"
        popupVisible={open}
        onVisibleChange={setOpen}
        content={
          <div className="min-w-[220px] rounded-xl bg-popover p-2">
            <div className="mb-1 px-2 text-[11px] text-muted-foreground">{t("workspaceSwitchLabel")}</div>
            <div className="space-y-1">
              {WORKSPACE_OPTIONS.map((opt) => {
                const active = opt.value === workspaceName;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm",
                      active ? "bg-accent text-accent-foreground" : "hover:bg-accent/70",
                    )}
                    onClick={() => {
                      if (opt.value !== workspaceName) {
                        saveWorkspaceName(opt.value);
                        window.location.reload();
                      }
                      setOpen(false);
                    }}
                  >
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/15 text-primary">
                      {opt.value === "openclaw" ? (
                        <OpenclawWorkspaceIcon className="h-4 w-4" />
                      ) : opt.value === "hermes-agent" ? (
                        <Image
                          src="/hermes-agent.png"
                          alt="Hermes-Agent"
                          width={16}
                          height={16}
                          className="h-4 w-4 rounded-full object-cover"
                        />
                      ) : (
                        <IconUser className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        }
      >
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/60 px-2.5 py-2 text-left"
          aria-label={t("workspaceSwitchAria")}
        >
          <span className="grid h-6 w-6 place-items-center rounded-md bg-primary/15 text-primary">
            {current.value === "openclaw" ? (
              <OpenclawWorkspaceIcon className="h-4 w-4" />
            ) : current.value === "hermes-agent" ? (
              <Image
                src="/hermes-agent.png"
                alt="Hermes-Agent"
                width={16}
                height={16}
                className="h-4 w-4 rounded-full object-cover"
              />
            ) : (
              <IconUser className="h-3.5 w-3.5" />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-sidebar-foreground">{current.label}</span>
          <ChevronDownThin className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </Popover>
    </div>
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
      { href: "/observe/overview", label: t("metrics"), Icon: NavIconMetrics },
    ],
    [t],
  );

  const auditItems: NavDef[] = useMemo(
    () => [
      { href: "/resource-audit", label: t("resourceAudit"), Icon: NavIconResourceAudit },
      { href: "/command-analysis", label: t("commandAnalysis"), Icon: NavIconCommandExec },
    ],
    [t],
  );

  const securityItems: NavDef[] = useMemo(
    () => [{ href: "/data-security", label: t("dataSecurity"), Icon: NavIconDataSecurity }],
    [t],
  );

  const settingsItems: NavDef[] = useMemo(
    () => [
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
        <WorkspaceSwitcher collapsed={collapsed} />
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
