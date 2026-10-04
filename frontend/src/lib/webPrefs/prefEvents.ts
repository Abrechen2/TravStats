import { create } from "zustand";

/**
 * The two signals that connect raw-localStorage preferences to the web-prefs
 * sync (forgejo#200), so the sync does not have to live inside each writer.
 *
 * OUTGOING — `emitLocalPrefWrite(key)`: a writer that persists a synced
 * preference straight to localStorage (not through a Zustand store the sync
 * can subscribe to) calls this after its `setItem`. One line per writer;
 * the sync decides whether anything actually changed.
 *
 * INCOMING — `useWebPrefsEpoch(section)`: bumps when the sync has written a
 * value from the server into localStorage. Components that copied a stored
 * value into `useState` at mount re-read (or remount) on a bump; without it
 * they would keep showing — and, on their next save, write back — the value
 * from before the server's arrived.
 */

type Listener = (key: string) => void;
const listeners = new Set<Listener>();

export function emitLocalPrefWrite(key: string): void {
  for (const listener of listeners) {
    try {
      listener(key);
    } catch {
      // A broken listener must not stop a preference from being saved.
    }
  }
}

/** Calls `onWrite` for every emitted key `matches` accepts. Returns the unsubscribe. */
export function onLocalPrefWrite(
  matches: (key: string) => boolean,
  onWrite: () => void
): () => void {
  const listener: Listener = (key) => {
    if (matches(key)) onWrite();
  };
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

interface EpochState {
  epochs: Readonly<Record<string, number>>;
  bump: (section: string) => void;
}

export const useWebPrefsEpochStore = create<EpochState>((set) => ({
  epochs: {},
  bump: (section) =>
    set((s) => ({ epochs: { ...s.epochs, [section]: (s.epochs[section] ?? 0) + 1 } })),
}));

/** 0 until the server's value for `section` has been applied on this page. */
export function useWebPrefsEpoch(section: string): number {
  return useWebPrefsEpochStore((s) => s.epochs[section] ?? 0);
}
