import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MapTheme } from "../types/mapTheme";

/**
 * TravStats is dark-only — see TravStatsWeb/brand/BRAND.md §1.1.
 * This store no longer manages a light/dark UI mode. It survives only
 * to host the `mapTheme` preference (glassmorphism / classic), which
 * is a separate concern from the (removed) UI dark/light toggle.
 *
 * The `dark` class on <html> is set at module load so any third-party
 * CSS scoped to `html.dark` keeps working without a toggle.
 */

interface ThemeState {
  mapTheme: MapTheme;
  setMapTheme: (theme: MapTheme) => void;
}

if (typeof document !== "undefined") {
  document.documentElement.classList.add("dark");
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mapTheme: "glassmorphism" as MapTheme,
      setMapTheme: (theme) => set({ mapTheme: theme }),
    }),
    {
      name: "theme-storage",
      // Keep the storage key stable so the user's mapTheme preference
      // carries over from the previous schema (which also stored
      // `mapTheme` under the same key alongside `isDarkMode`). The
      // legacy `isDarkMode` field is silently discarded by the
      // partializer below.
      partialize: (state) => ({ mapTheme: state.mapTheme }),
      skipHydration: typeof window === "undefined",
    }
  )
);
