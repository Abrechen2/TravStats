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
  clearSession: () => void;
  setHasHydrated: (value: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => {
      // Listen for unauthorized events from API interceptor
      if (typeof window !== "undefined") {
        window.addEventListener("auth:unauthorized", async () => {
          const store = get();
          if (store.user) {
            await store.logout();
          }
        });
      }

      return {
        user: null,
        _hasHydrated: false,
        setHasHydrated: (value) => set({ _hasHydrated: value }),
        setAuth: (user) => {
          // JWT is now stored in HttpOnly cookie (more secure)
          set({ user });
        },
        // Drops the local session without calling the server. Used when the
        // server has ALREADY rejected the cookie — a logout round-trip would
        // only confirm what the 401 just told us.
        clearSession: () => set({ user: null }),
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
      },
    }
  )
);
