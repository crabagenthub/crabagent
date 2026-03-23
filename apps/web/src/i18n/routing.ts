import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "zh-CN"],
  defaultLocale: "zh-CN",
  /** Always use `/zh-CN/...` or `/en/...` so App Router `[locale]` matches reliably. */
  localePrefix: "always",
  /** Remember UI language after `router.replace(..., { locale })` from the nav switcher. */
  localeCookie: {
    name: "CRABAGENT_LOCALE",
    maxAge: 60 * 60 * 24 * 365,
  },
});
