import { create } from "zustand";

/**
 * Which bus ride's line the dashboard is drawing by hand (GitHub #409). The bus
 * card on the map asks here; `BusRouteEditHost` on the dashboard page obeys.
 * Instance state, never persisted.
 */
interface BusRouteEditState {
  rideId: string | null;
  open: (rideId: string) => void;
  close: () => void;
}

export const useBusRouteEditStore = create<BusRouteEditState>((set) => ({
  rideId: null,
  open: (rideId) => set({ rideId }),
  close: () => set({ rideId: null }),
}));
