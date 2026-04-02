"use client";

import { useTranslations } from "next-intl";
import { Fragment, useMemo } from "react";
import { usePathname } from "@/i18n/navigation";
import { LocalizedLink } from "@/components/localized-link";

type Crumb = { label: string; href?: string };

function shortenTraceId(id: string): string {
  const t = id.trim();
  if (t.length <= 18) {
    return t;
  }
  return `${t.slice(0, 12)}…`;
}

/**
 * 顶栏面包屑：与侧栏分组一致，`父级 / 当前页` 浅灰分隔（参考常见控制台）。
 */
export function AppBreadcrumb() {
  const pathname = usePathname();
  const tNav = useTranslations("Nav");
  const tHome = useTranslations("Home");

  const items: Crumb[] = useMemo(() => {
    const p = pathname === "" ? "/" : pathname;

    if (p === "/") {
      return [{ label: tHome("title") }];
    }

    if (p === "/overview") {
      return [
        { label: tNav("groupMain") },
        { label: tNav("overview") },
      ];
    }

    if (p.startsWith("/traces/")) {
      const raw = p.slice("/traces/".length);
      const id = decodeURIComponent(raw.split("/")[0] ?? "").trim();
      if (id) {
        return [
          { label: tNav("groupObserve") },
          { label: tNav("traces"), href: "/traces" },
          { label: shortenTraceId(id) },
        ];
      }
    }

    if (p === "/traces" || p.startsWith("/traces?")) {
      return [{ label: tNav("groupObserve") }, { label: tNav("traces") }];
    }

    if (p === "/resource-audit") {
      return [{ label: tNav("groupObserve") }, { label: tNav("resourceAudit") }];
    }

    if (p === "/logs") {
      return [{ label: tNav("groupObserve") }, { label: tNav("logs") }];
    }

    if (p === "/analytics") {
      return [{ label: tNav("groupObserve") }, { label: tNav("analytics") }];
    }

    if (p === "/machines") {
      return [{ label: tNav("groupOps") }, { label: tNav("machines") }];
    }

    if (p === "/alerts") {
      return [{ label: tNav("groupOps") }, { label: tNav("alerts") }];
    }

    if (p === "/settings") {
      return [{ label: tNav("groupSettings") }, { label: tNav("settings") }];
    }

    return [{ label: tNav("brand") }];
  }, [pathname, tNav, tHome]);

  if (items.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label={tNav("breadcrumbAria")}
      className="shrink-0 bg-background px-4 py-2.5 md:px-6"
    >
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] leading-snug">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <Fragment key={`${i}-${item.label}`}>
              {i > 0 ? (
                <span className="select-none text-muted-foreground/50" aria-hidden>
                  /
                </span>
              ) : null}
              <li className="min-w-0 truncate">
                {item.href && !last ? (
                  <LocalizedLink
                    href={item.href}
                    className="text-muted-foreground transition hover:text-foreground no-underline"
                  >
                    {item.label}
                  </LocalizedLink>
                ) : (
                  <span
                    className={last ? "font-medium text-foreground" : "text-muted-foreground"}
                  >
                    {item.label}
                  </span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
