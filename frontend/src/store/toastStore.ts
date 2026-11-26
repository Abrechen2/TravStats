import { create } from "zustand";

export type ToastType = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number; // in milliseconds, default 5000
  /** An undoable toast: what was done, and the button that takes it back. */
  undo?: {
    onUndo: () => void | false;
    /** Overrides the default "Rückgängig" (e.g. a clearer verb). */
    label?: string;
    /** A second, smaller line: what the undo brings back. */
    detail?: string;
  };
}

export interface UndoableToast {
  /** What was done — "Station Rom entfernt". */
  label: string;
  /** Return `false` to keep the toast: the undo could not run yet (a save is in flight). */
  onUndo: () => void | false;
  /** How long the undo is on offer, in milliseconds. Default 8000. */
  ttl?: number;
  undoLabel?: string;
  detail?: string;
}

/** The undo window. One number, so every "Rückgängig" in the app lasts the same. */
export const UNDO_TTL_MS = 8000;

interface ToastState {
  toasts: Toast[];
  addToast: (type: ToastType, message: string, duration?: number) => string;
  addUndoable: (toast: UndoableToast) => string;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

type Setter = (fn: (state: ToastState) => Partial<ToastState>) => void;

function addTo(set: Setter, input: Omit<Toast, "id">): string {
  const id = Math.random().toString(36).substring(2, 9);
  set((state) => ({ toasts: [...state.toasts, { ...input, id }] }));
  // Auto-remove after duration
  if (input.duration && input.duration > 0) {
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, input.duration);
  }
  return id;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (type, message, duration = 5000) => addTo(set, { type, message, duration }),
  addUndoable: ({ label, onUndo, ttl = UNDO_TTL_MS, undoLabel, detail }) =>
    addTo(set, {
      type: "info",
      message: label,
      duration: ttl,
      undo: { onUndo, label: undoLabel, detail },
    }),
  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
  clearToasts: () => {
    set({ toasts: [] });
  },
}));

/**
 * The toast API outside React. Success and undo are the only things a toast is
 * for: a field error sits at its field, a page error is a Banner.
 * `toast.undoable` replaced five hand-built undo bars.
 */
export const toast = {
  success: (message: string, duration?: number): string =>
    useToastStore.getState().addToast("success", message, duration),
  undoable: (input: UndoableToast): string => useToastStore.getState().addUndoable(input),
  dismiss: (id: string): void => useToastStore.getState().removeToast(id),
};
