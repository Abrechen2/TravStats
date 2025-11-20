import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ThemeState {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  setDarkMode: (isDark: boolean) => void;
}

const updateDarkMode = (isDark: boolean) => {
  if (isDark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      isDarkMode: false,
      toggleDarkMode: () =>
        set((state) => {
          const newMode = !state.isDarkMode;
          updateDarkMode(newMode);
          return { isDarkMode: newMode };
        }),
      setDarkMode: (isDark) => {
        updateDarkMode(isDark);
        set({ isDarkMode: isDark });
      },
    }),
    {
      name: 'theme-storage',
      onRehydrateStorage: () => (state) => {
        // Apply dark mode immediately after hydration
        if (state?.isDarkMode) {
          updateDarkMode(true);
        }
      },
    }
  )
);

// Initialize dark mode on load (sync)
if (typeof window !== 'undefined') {
  const stored = localStorage.getItem('theme-storage');
  if (stored) {
    try {
      const { state } = JSON.parse(stored);
      if (state?.isDarkMode) {
        updateDarkMode(true);
      }
    } catch (e) {
      // Ignore parse errors
    }
  }
}
