import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "../types";
import { authApi } from "../lib/api";
import { logger } from "../lib/logger";
import { useDashboardCountsStore } from "./dashboardCountsStore";
import { forgetQuotaRefusals } from "../lib/bulkRefreshRefusal";

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
        //
        // Also resets `dashboardCountsStore`: logout/login is an SPA
        // navigation (NavigationBar calls `logout()` then `navigate`,
        // LoginPage calls `setAuth()` then `navigate` — no page reload), so
        // the module-level counts store would otherwise keep showing
        // account A's numbers in the tab strip for however long it takes
        // account B's own fetch to land. Only the 401 interceptor path does
        // a hard reload; this store's own transitions do not, so both of
        // them must clear it themselves (critical finding, review round 1
        // of the 2026-09-17 alex-design-feedback task 2 fix).
        clearSession: () => {
          useDashboardCountsStore.getState().reset();
          // Same reason as the counts store above, and the same SPA
          // navigation: a 403 the server gave THIS account must not follow
          // the next one into the same tab (review, 2026-09-19).
          forgetQuotaRefusals();
          set({ user: null });
        },
        logout: async () => {
          try {
            // Clear the HttpOnly cookie on server
            await authApi.logout();
          } catch (error) {
            logger.error("Logout error:", error);
          } finally {
            // Clear local user state regardless of API result
            useDashboardCountsStore.getState().reset();
            forgetQuotaRefusals();
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
