/** Root pass-through; `<html>` lives in `[locale]/layout.tsx` (next-intl). */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
