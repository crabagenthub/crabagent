import typography from "@tailwindcss/typography";
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: "var(--destructive)",
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        sidebar: {
          DEFAULT: "var(--sidebar)",
          foreground: "var(--sidebar-foreground)",
          primary: "var(--sidebar-primary)",
          "primary-foreground": "var(--sidebar-primary-foreground)",
          accent: "var(--sidebar-accent)",
          "accent-foreground": "var(--sidebar-accent-foreground)",
          active: "var(--sidebar-active)",
          "active-foreground": "var(--sidebar-active-foreground)",
          border: "var(--sidebar-border)",
          ring: "var(--sidebar-ring)",
        },
        ca: {
          /** Light shell sidebar (reference: panel + rail layout) */
          shell: {
            sidebar: "#f3f3f5",
            "sidebar-hover": "#e8e8ec",
            border: "#e4e4e7",
            text: "#18181b",
            muted: "#71717a",
          },
          sidebar: "#171717",
          "sidebar-hover": "#212121",
          "sidebar-border": "rgba(255,255,255,0.08)",
          "sidebar-text": "#ececec",
          "sidebar-muted": "#8e8e8e",
          /** App shell main pane (also use bg-white in layout) */
          main: "#ffffff",
          surface: "#ffffff",
          border: "#e5e5e5",
          muted: "#71717a",
          accent: "#10a37f",
          "accent-hover": "#0d8f6e",
          danger: "#ef4444",
          "danger-soft": "#fef2f2",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      ringOffsetColor: {
        sidebar: "var(--sidebar)",
      },
      boxShadow: {
        ca: "0 1px 2px rgba(0,0,0,0.04), 0 4px 24px rgba(0,0,0,0.06)",
        "ca-sm": "0 1px 2px rgba(0,0,0,0.05)",
      },
    },
  },
  plugins: [typography],
};

export default config;
