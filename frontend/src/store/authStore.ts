import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "../types";
import { authApi } from "../lib/api";
import { logger } from "../lib/logger";

interface AuthState {
  user: User | null;
  _hasHydrated: boolean;
  setAuth: (user: User) => void;
  logout: () => Promise<void>;
  setHasHydrated: (value: boolean) => void;
}

// Event listener cleanup function
let unauthorizedEventListener: ((event: Event) => void) | null = null;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => {
      // Listen for unauthorized events from API interceptor
      if (typeof window !== "undefined") {
        unauthorizedEventListener = async () => {
          const store = get();
          if (store.user) {
            // User is logged in but got 401 - logout
            await store.logout();
          }
        };
        window.addEventListener("auth:unauthorized", unauthorizedEventListener);
      }

      return {
        user: null,
        _hasHydrated: false,
        setHasHydrated: (value) => set({ _hasHydrated: value }),
        setAuth: (user) => {
          // JWT is now stored in HttpOnly cookie (more secure)
          set({ user });
        },
        logout: async () => {
          try {
            // Clear the HttpOnly cookie on server
            await authApi.logout();
          } catch (error) {
            logger.error("Logout error:", error);
          } finally {
            // Clear local user state regardless of API result
            set({ user: null });
          }
        },
      };
    },
    {
      name: "auth-storage",
      // Only persist user data, not token (token is in HttpOnly cookie)
      partialize: (state) => ({ user: state.user }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
        // Cleanup event listener on store rehydration
        if (typeof window !== "undefined" && unauthorizedEventListener) {
          window.removeEventListener("auth:unauthorized", unauthorizedEventListener);
          unauthorizedEventListener = null;
        }
      },
    }
  )
);
