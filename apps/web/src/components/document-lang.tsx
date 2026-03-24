"use client";

import { useEffect } from "react";

/** Sync `<html lang>` with active locale (root layout uses default locale only). */
export function DocumentLang({ locale }: { locale: string }) {
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return null;
}
