import type { AbstractIntlMessages } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import en from "../../messages/en.json";
import zhCN from "../../messages/zh-CN.json";
import { routing } from "./routing";

/** 将英文文案作为基底合并进 zh-CN，避免某分支漏译键时客户端出现 MISSING_MESSAGE。 */
function deepMergeMessages(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const b = result[key];
    const o = override[key];
    if (
      o !== undefined &&
      o !== null &&
      typeof o === "object" &&
      !Array.isArray(o) &&
      b !== null &&
      typeof b === "object" &&
      !Array.isArray(b)
    ) {
      result[key] = deepMergeMessages(b as Record<string, unknown>, o as Record<string, unknown>);
    } else {
      result[key] = o;
    }
  }
  return result;
}

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
