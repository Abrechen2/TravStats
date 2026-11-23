import { create } from "zustand";

/**
 * Which ferry crossing's line the dashboard is drawing by hand (GitHub #407).
 * The ferry card on the map asks here; `FerryRouteEditHost` on the dashboard
 * page obeys. Instance state, never persisted.
 */
interface FerryRouteEditState {
  crossingId: string | null;
  open: (crossingId: string) => void;
  close: () => void;
}

export const useFerryRouteEditStore = create<FerryRouteEditState>((set) => ({
  crossingId: null,
  open: (crossingId) => set({ crossingId }),
  close: () => set({ crossingId: null }),
}));
