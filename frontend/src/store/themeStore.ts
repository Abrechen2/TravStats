import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ThemeState {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  setDarkMode: (isDark: boolean) => void;
}

const updateDarkMode = (isDark: boolean) => {
  if (typeof document === 'undefined') return;
  
  if (isDark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
};

// Helper function to get initial theme from localStorage or system preference
const getInitialTheme = (): boolean => {
  if (typeof window === 'undefined') return false;
  
  try {
    const stored = localStorage.getItem('theme-storage');
    if (stored) {
      const parsed = JSON.parse(stored);
      // Check if state exists and has isDarkMode property
      if (parsed?.state && typeof parsed.state.isDarkMode === 'boolean') {
        return parsed.state.isDarkMode;
      }
    }
  } catch (e) {
    console.warn('Error reading theme from localStorage:', e);
  }
  
  // Fallback to system preference if no storage or error
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  
  return false;
};

// Initialize immediately to prevent flash of wrong theme
// This runs synchronously before React renders
if (typeof window !== 'undefined') {
  const initialTheme = getInitialTheme();
  updateDarkMode(initialTheme);
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => {
      // Initialize with the value from localStorage or system preference
      const initialTheme = getInitialTheme();
      
      return {
        isDarkMode: initialTheme,
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
      };
    },
    {
      name: 'theme-storage',
      // Ensure DOM is updated after rehydration
      onRehydrateStorage: () => {
        return (state, error) => {
          if (error) {
            console.warn('Error rehydrating theme store:', error);
            // Fallback to system preference on error
            if (typeof window !== 'undefined' && window.matchMedia) {
              const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
              updateDarkMode(systemPrefersDark);
            }
            return;
          }
          
          if (state) {
            updateDarkMode(state.isDarkMode);
          } else {
            // If no state, use system preference
            const systemPrefersDark = typeof window !== 'undefined' && window.matchMedia
              ? window.matchMedia('(prefers-color-scheme: dark)').matches
              : false;
            updateDarkMode(systemPrefersDark);
          }
        };
      },
      // Skip hydration if we're on server
      skipHydration: typeof window === 'undefined',
    }
  )
);
