"use client";

import "@/lib/arco-react19-setup";
import { ConfigProvider } from "@arco-design/web-react";
import enUS from "@arco-design/web-react/es/locale/en-US";
import zhCN from "@arco-design/web-react/es/locale/zh-CN";
import type { ReactNode } from "react";

import type { AppLocale } from "@/i18n/routing";
import { arcoDesignInput } from "@/lib/arco-design-input";

/**
 * Arco 主色与文本/边框跟随 `globals.css` 中 Tailwind 语义变量（含 `.dark`），
 * 避免与页面 shadcn 主题两套蓝色脱节。`borderRadius` 与 `--radius` 大致同级（~0.5rem）。
 * `locale` 与 `next-intl` 路由语言一致，表格空状态、分页等内置文案随之切换。
 */
export function ArcoProvider({ children, locale }: { children: ReactNode; locale: AppLocale }) {
  const arcoLocale = locale === "zh-CN" ? zhCN : enUS;
  const radius = arcoDesignInput.theme.radius.basePx;

  return (
    <ConfigProvider
      locale={arcoLocale}
      theme={{
        token: {
          colorPrimary: "var(--primary)",
          colorText: "var(--foreground)",
          colorTextSecondary: "var(--muted-foreground)",
          colorBorder: "var(--border)",
          colorBgPopup: "var(--popover)",
          colorBgElevated: "var(--popover)",
          borderRadius: radius,
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}
