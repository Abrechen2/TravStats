import { create } from "zustand";

interface DialogStackState {
  /** Open `ui/Dialog`s, oldest first. The last one is on top. */
  open: string[];
  push: (id: string) => void;
  remove: (id: string) => void;
}

/**
 * Which dialog is on top. A failure reported while a dialog is open has to be
 * seen THERE: a banner at the page top sits behind the scrim.
 */
export const useDialogStackStore = create<DialogStackState>((set) => ({
  open: [],
  push: (id) => set((s) => (s.open.includes(id) ? s : { open: [...s.open, id] })),
  remove: (id) => set((s) => ({ open: s.open.filter((x) => x !== id) })),
}));
