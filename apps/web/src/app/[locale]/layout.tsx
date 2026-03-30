import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AppBreadcrumb } from "@/components/app-breadcrumb";
import { DocumentLang } from "@/components/document-lang";
import { QueryProvider } from "@/components/query-provider";
import { SiteNav } from "@/components/site-nav";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
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
    <NextIntlClientProvider messages={messages}>
      <DocumentLang locale={locale} />
      <QueryProvider>
        <TooltipProvider delay={200}>
          <div
            className={`${inter.variable} ${inter.className} flex h-dvh min-h-0 w-full overflow-hidden antialiased`}
          >
            <SiteNav />
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
              <AppBreadcrumb />
              <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</div>
            </div>
          </div>
          <Toaster richColors position="top-center" />
        </TooltipProvider>
      </QueryProvider>
    </NextIntlClientProvider>
  );
}
