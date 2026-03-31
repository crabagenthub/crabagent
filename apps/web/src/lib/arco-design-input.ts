export const arcoDesignInput = {
  theme: {
    palette: {
      family: "purple-brand",
      primary: "oklch(0.488 0.243 264.376)",
      success: "oklch(0.68 0.17 151)",
      warning: "oklch(0.78 0.16 84)",
      danger: "oklch(0.577 0.245 27.325)",
    },
    radius: {
      basePx: 6,
    },
    motion: {
      preset: "balanced",
      enterMs: 200,
      exitMs: 160,
      curve: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    },
    states: {
      selected: "bg-only",
      focusRing: "2px-clear",
      disabledOpacity: 0.5,
      darkModeInScope: true,
    },
  },
} as const;

