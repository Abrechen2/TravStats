import { useAuthStore } from "../store/authStore";

/** True for the shared demo account (see backend middleware/demoGuard.ts). */
export function useIsDemoAccount(): boolean {
  return useAuthStore((s) => s.user?.isDemo === true);
}
