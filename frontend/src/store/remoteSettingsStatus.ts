import { create } from "zustand";

/**
 * Whether the last `loadRemoteSettings` could not read the server. Not
 * persisted. A guard that waits on `enabledDomainsLoaded` reads it to show a
 * retry instead of spinning forever, and the settings auto-save reads it so
 * local defaults are never written over the account's values (forgejo#372).
 * Its own module because `settingsStore.ts` sits at the 800-line limit.
 */
export const useRemoteSettingsStatus = create<{
  failed: boolean;
  setFailed: (failed: boolean) => void;
}>((set) => ({ failed: false, setFailed: (failed) => set({ failed }) }));
