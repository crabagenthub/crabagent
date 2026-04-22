import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ArcoProvider } from "@/components/arco-provider";
import { AppBreadcrumb } from "@/components/app-breadcrumb";
import { DocumentLang } from "@/components/document-lang";
import { QueryProvider } from "@/components/query-provider";
import { SiteNavNoSSR } from "@/components/site-nav-no-ssr";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { type AppLocale, routing } from "@/i18n/routing";
import { SIDEBAR_COLLAPSED_STORAGE_KEY } from "@/lib/sidebar-storage";
import { CA_THEME_STORAGE_KEY } from "@/lib/theme-storage";
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
  if (!routing.locales.includes(locale as AppLocale)) {
    notFound();
  }
  setRequestLocale(locale);
  const messages = await getMessages();
  const appLocale: AppLocale = locale as AppLocale;

  const sidebarInitScript = `(function(){try{var k=${JSON.stringify(SIDEBAR_COLLAPSED_STORAGE_KEY)};var v=localStorage.getItem(k);document.documentElement.setAttribute("data-sidebar-collapsed",v==="1"?"1":"0");}catch(e){document.documentElement.setAttribute("data-sidebar-collapsed","0");}})();`;

  const themeInitScript = `(function(){function p(v){return v==="light"||v==="dark"||v==="system"?v:"system";}function r(a,b){if(a==="dark")return true;if(a==="light")return false;return b;}try{var k=${JSON.stringify(CA_THEME_STORAGE_KEY)};var pref=p(localStorage.getItem(k));var sys=window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",r(pref,sys));}catch(e){document.documentElement.classList.remove("dark");}})();`;

  return (
    <NextIntlClientProvider messages={messages}>
      <Script id="ca-sidebar-collapsed-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: sidebarInitScript }} />
      <Script id="ca-theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      <DocumentLang locale={appLocale} />
      <QueryProvider>
        <ThemeProvider>
          <ArcoProvider locale={appLocale}>
            <TooltipProvider delay={200}>
              <div
                className={`${inter.variable} ${inter.className} flex h-dvh min-h-0 w-full overflow-hidden antialiased`}
              >
                <SiteNavNoSSR />
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
                  <AppBreadcrumb />
                  <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</div>
                </div>
              </div>
            </TooltipProvider>
          </ArcoProvider>
        </ThemeProvider>
      </QueryProvider>
    </NextIntlClientProvider>
  );
}
