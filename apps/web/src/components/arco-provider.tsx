"use client";

import "@/lib/arco-react19-setup";
import { ConfigProvider } from "@arco-design/web-react";
import enUS from "@arco-design/web-react/es/locale/en-US";
import zhCN from "@arco-design/web-react/es/locale/zh-CN";
import type { ReactNode } from "react";

import type { AppLocale } from "@/i18n/routing";

/**
 * 亮/暗与 Arco 组件样式由 `body[arco-theme]` + `arco.css` 与 `ThemeProvider` 同步；此处仅配置语言。
 * （`ConfigProvider` 的 `theme` 扁平色键会经 `setTheme` 写内联样式且仅支持 hex，故不用 `theme.token` 桥接 CSS 变量。）
 */
export function ArcoProvider({ children, locale }: { children: ReactNode; locale: AppLocale }) {
  const arcoLocale = locale === "zh-CN" ? zhCN : enUS;

  return <ConfigProvider locale={arcoLocale}>{children}</ConfigProvider>;
}
