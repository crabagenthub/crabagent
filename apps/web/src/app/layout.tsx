import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  icons: {
    icon: [
      { url: "https://openclaw.ai/favicon.svg", type: "image/svg+xml" },
      { url: "https://openclaw.ai/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "https://openclaw.ai/apple-touch-icon.png",
  },
};

/**
 * Next.js requires `<html>` and `<body>` in the root layout.
 * Actual `lang` is synced per locale in `DocumentLang` inside `[locale]/layout.tsx`.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={routing.defaultLocale} suppressHydrationWarning className={cn("font-sans", geist.variable)}>
      <body>{children}</body>
    </html>
  );
}
