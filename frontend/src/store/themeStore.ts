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

// Initialize immediately to prevent flash
if (typeof window !== 'undefined') {
  try {
    const stored = localStorage.getItem('theme-storage');
    let isDark = false;

    if (stored) {
      const { state } = JSON.parse(stored);
      // Check if state exists and has isDarkMode property
      if (state && typeof state.isDarkMode === 'boolean') {
        isDark = state.isDarkMode;
      }
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      // Default to system preference if no storage
      isDark = true;
    }

    updateDarkMode(isDark);
  } catch (e) {
    // Ignore errors
    console.warn('Error initializing theme:', e);
  }
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      isDarkMode: false, // Default value, will be overwritten by persist
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
        // Ensure DOM matches state after hydration
        if (state) {
          updateDarkMode(state.isDarkMode);
        }
      },
    }
  )
);
