import { useAuthStore } from "../store/authStore";

/**
 * True for the SHARED demo account — the one whose password is published on
 * the login page of a public instance (see backend `utils/sharedDemo.ts`).
 * Deliberately not the raw `isDemo` flag: every account `seedDemoUser` creates
 * carries that, including the preview's own admin and the local dev admin, and
 * those own their settings.
 */
export function useIsDemoAccount(): boolean {
  return useAuthStore((s) => s.user?.isSharedDemo === true);
}
