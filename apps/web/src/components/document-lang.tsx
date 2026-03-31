"use client";

import { useEffect } from "react";

import type { AppLocale } from "@/i18n/routing";

/** Sync `<html lang>` with active locale (root layout uses default locale only). */
export function DocumentLang({ locale }: { locale: AppLocale }) {
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return null;
}
