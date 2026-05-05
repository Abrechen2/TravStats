import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MapTheme } from "../types/mapTheme";

// BRAND.md §1.1: TravStats is dark-only — no light mode toggle, no
// `prefers-color-scheme` fallback. `<html class="dark">` is hardcoded
// in index.html. This store now only persists the user's map style
// preference (mapTheme).

interface ThemeState {
  mapTheme: MapTheme;
  setMapTheme: (theme: MapTheme) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mapTheme: "glassmorphism" as MapTheme,
      setMapTheme: (theme) => set({ mapTheme: theme }),
    }),
    {
      name: "theme-storage",
      skipHydration: typeof window === "undefined",
    }
  )
);
