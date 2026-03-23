import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { QueryProvider } from "@/components/query-provider";
import { SiteNav } from "@/components/site-nav";
import { routing } from "@/i18n/routing";
import "../globals.css";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Crabagent",
  description: "OpenClaw trace console",
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as "en" | "zh-CN")) {
    notFound();
  }
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html lang={locale} className={inter.variable}>
      <body
        className={`${inter.className} h-dvh overflow-hidden antialiased`}
      >
        <NextIntlClientProvider messages={messages}>
          <QueryProvider>
            <div className="flex h-full min-h-0 w-full overflow-hidden">
              <SiteNav />
              <div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-white">{children}</div>
            </div>
          </QueryProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
