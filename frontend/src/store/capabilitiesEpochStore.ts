import { create } from "zustand";

/** The features whose instance switch lives in Admin → Instanz. */
export type SwitchedFeature = "travPlan" | "travTrack";

interface CapabilitiesEpochState {
  epoch: Record<SwitchedFeature, number>;
  /** Called after a switch is saved: every capabilities reader asks again. */
  bump: (feature: SwitchedFeature) => void;
}

/**
 * A counter per feature that a capabilities read depends on (Codex P2,
 * 2026-10-26). The navigation reads `/travplan/capabilities` and
 * `/travtrack/capabilities` once per session; without this, a switch flipped
 * in Admin → Instanz changed only its own card and the menu entry stayed
 * wrong until a reload.
 */
export const useCapabilitiesEpochStore = create<CapabilitiesEpochState>((set) => ({
  epoch: { travPlan: 0, travTrack: 0 },
  bump: (feature) => set((s) => ({ epoch: { ...s.epoch, [feature]: s.epoch[feature] + 1 } })),
}));
