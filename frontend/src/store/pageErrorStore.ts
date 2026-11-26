import { create } from "zustand";

export type PageErrorTone = "error" | "warning";

export interface PageError {
  id: string;
  tone: PageErrorTone;
  message: string;
}

interface PageErrorState {
  errors: PageError[];
  report: (message: string, tone?: PageErrorTone) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

/** More than this at once is noise: the oldest make room for the newest. */
const MAX_VISIBLE = 3;

/**
 * Failures with no natural place of their own — a background action, a menu
 * item, a save that has left its form. They are shown by `PageErrorHost` as a
 * `Banner` at the top of the current page and stay until dismissed or the
 * route changes. A toast is for success and undo only.
 */
export const usePageErrorStore = create<PageErrorState>((set) => ({
  errors: [],
  report: (message, tone = "error") =>
    set((state) => {
      if (state.errors.some((e) => e.message === message && e.tone === tone)) return state;
      const id = Math.random().toString(36).substring(2, 9);
      return { errors: [...state.errors, { id, tone, message }].slice(-MAX_VISIBLE) };
    }),
  dismiss: (id) => set((state) => ({ errors: state.errors.filter((e) => e.id !== id) })),
  clear: () => set({ errors: [] }),
}));

/** Callable outside React, like `toast`. */
export function reportPageError(message: string, tone: PageErrorTone = "error"): void {
  usePageErrorStore.getState().report(message, tone);
}
