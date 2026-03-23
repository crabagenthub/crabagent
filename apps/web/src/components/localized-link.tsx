"use client";

import NextLink from "next/link";
import { useLocale } from "next-intl";
import type { ComponentProps } from "react";

type NextLinkProps = ComponentProps<typeof NextLink>;

/**
 * App Router + `[locale]` segment: use absolute path `/${locale}/...` so clicks always navigate
 * (avoids edge cases with next-intl Link + hydration).
 */
export function LocalizedLink({
  href,
  prefetch = true,
  ...rest
}: Omit<NextLinkProps, "href"> & { href: string }) {
  const locale = useLocale();
  const path = href === "/" ? "" : href.startsWith("/") ? href : `/${href}`;
  const fullHref = `/${locale}${path}`;

  return <NextLink href={fullHref} prefetch={prefetch} {...rest} />;
}
