export const colors = {
  background: "#0C0F1A", // deep navy — Gru's Lair
  surface: "#111528", // sidebar background
  surfaceSecondary: "#181C2E", // header/footer backgrounds
  surfaceElevated: "#1E2235", // hover/raised surfaces
  surfaceSunken: "#080B16", // deeper backgrounds
  border: "#252A40",
  borderSubtle: "#1E2235",
  separator: "#1E2235",
  foregroundPrimary: "#E2E4EB",
  foregroundSecondary: "#9098B8",
  foregroundMuted: "#6B7394",
  foregroundInverted: "#0C0F1A",
  accent: "#FBBF24", // Minion Yellow
  accentHover: "#FCD34D",
  accentMuted: "rgba(251, 191, 36, 0.08)",
  warning: "#ffc107",
  danger: "#f44336",
  success: "#4caf50",
  successBackground: "#e6ffec",
  error: "#f44336",
  errorBackground: "#ffeef0",
  info: "#3794ff",
  foregroundTertiary: "#6B7394",
  overlay: "rgba(8, 11, 22, 0.4)",
  inputBackground: "#0C0F1A",
  inputBorder: "#252A40",
  inputBorderFocused: "#FBBF24",
  chipBackground: "rgba(251, 191, 36, 0.16)",
  chipBorder: "rgba(251, 191, 36, 0.4)",
  backdrop: "rgba(8, 11, 22, 0.72)",

  // Mode colors (matching web/Electron src/styles/globals.css)
  // Plan Mode - blue (hsl(210 70% 40%) = #1f6bb8)
  planMode: "#1f6bb8",
  planModeHover: "#3b87c7", // hsl(210 70% 52%)
  planModeLight: "#6ba7dc", // hsl(210 70% 68%)
  planModeAlpha: "rgba(31, 107, 184, 0.1)",

  // Exec Mode - purple (hsl(268.56 94.04% 55.19%) = #a855f7)
  execMode: "#a855f7",
  execModeHover: "#b97aff", // hsl(268.56 94.04% 67%)
  execModeLight: "#d0a3ff", // hsl(268.56 94.04% 78%)

  // Edit Mode - green (hsl(120 50% 35%) = #2e8b2e)
  editMode: "#2e8b2e",
  editModeHover: "#3ea03e", // hsl(120 50% 47%)
  editModeLight: "#5ec15e", // hsl(120 50% 62%)

  // Thinking Mode - purple (hsl(271 76% 53%) = #9333ea)
  thinkingMode: "#9333ea",
  thinkingModeLight: "#a855f7", // hsl(271 76% 65%)
  thinkingBorder: "#9333ea", // hsl(271 76% 53%)

  // Other mode colors
  editingMode: "#ff8800", // hsl(30 100% 50%)
  editingModeAlpha: "rgba(255, 136, 0, 0.1)",
  pendingMode: "#ffb84d", // hsl(30 100% 70%)
  debugMode: "#4da6ff", // hsl(214 100% 64%)
} as const;

export type ThemeColors = typeof colors;
