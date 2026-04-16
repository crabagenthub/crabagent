import type { AbstractIntlMessages } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import en from "../../messages/en.json";
import zhCN from "../../messages/zh-CN.json";
import { deepMergeMessages } from "./merge-messages";
import { routing } from "./routing";

/** 静态导入，避免 Turbopack 对动态 `import(\`…/${locale}.json\`)` 的拆包遗漏新增键导致 MISSING_MESSAGE。 */
const messagesZhCN = deepMergeMessages(
  en as Record<string, unknown>,
  zhCN as Record<string, unknown>,
) as AbstractIntlMessages;

const messagesByLocale: Record<"en" | "zh-CN", AbstractIntlMessages> = {
  en: en as AbstractIntlMessages,
  "zh-CN": messagesZhCN,
};

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !routing.locales.includes(locale as "en" | "zh-CN")) {
    locale = routing.defaultLocale;
  }
  return {
    locale,
    messages: messagesByLocale[locale as "en" | "zh-CN"],
  };
});
