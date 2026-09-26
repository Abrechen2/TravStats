import { create } from "zustand";
import { isValidZone } from "../shared/time";

/**
 * Whether the SERVER holds a profile zone for this account (ADR 0002 D4/Q1;
 * owner decision 2026-09-26: users without one are asked at their next
 * login; until they confirm, "today" is answered in UTC with a visible hint).
 *
 * The web has always kept a zone of its own in `display.timezone` — detected
 * from the browser on first load and persisted locally — so the settings
 * store alone cannot tell "the user chose this" from "the browser guessed
 * this". The server's copy can: `loadRemoteSettings` reports what arrived,
 * and until the user confirms, the save path leaves the guessed zone out of
 * what it sends, so an unrelated settings save cannot confirm it in silence.
 *
 * Not persisted: it is a statement about the server, re-learned per session.
 */
export type ProfileZoneStatus = "unknown" | "missing" | "confirmed";

interface ProfileZoneState {
  status: ProfileZoneStatus;
  /** What the settings response said about `display.timezone`. */
  noteRemote: (remote: unknown) => void;
  /** A zone the user picked (prompt or settings page) is a confirmation. */
  markConfirmed: () => void;
  reset: () => void;
}

export const useProfileZoneStore = create<ProfileZoneState>((set) => ({
  status: "unknown",
  noteRemote: (remote) => {
    const zone = (remote as { display?: { timezone?: unknown } } | null | undefined)?.display
      ?.timezone;
    set({ status: typeof zone === "string" && isValidZone(zone) ? "confirmed" : "missing" });
  },
  markConfirmed: () => set({ status: "confirmed" }),
  reset: () => set({ status: "unknown" }),
}));

/**
 * The display slice as the save path may send it: without a zone the user
 * never confirmed. Only `missing` withholds it — `unknown` (the settings
 * never loaded) sends what it always sent, rather than blanking a stored zone.
 */
export function displayForSave<T extends { timezone?: string }>(display: T): T {
  if (useProfileZoneStore.getState().status !== "missing") return display;
  const { timezone: _unconfirmed, ...rest } = display;
  return rest as T;
}

/**
 * The zone "today", "past or planned" and countdowns are answered in (Q1):
 * the confirmed profile zone, else UTC — the same answer the server gives,
 * which is what the hint beside it says.
 */
export function todayZoneFrom(status: ProfileZoneStatus, profileZone: string | undefined): string {
  return status === "confirmed" && profileZone && isValidZone(profileZone) ? profileZone : "UTC";
}
