import { routing } from "@/i18n/routing";

/**
 * Next.js requires `<html>` and `<body>` in the root layout.
 * Actual `lang` is synced per locale in `DocumentLang` inside `[locale]/layout.tsx`.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={routing.defaultLocale} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
