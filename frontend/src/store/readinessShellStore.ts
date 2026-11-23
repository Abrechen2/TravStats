import { create } from "zustand";

import {
  fetchReadiness,
  fetchReadinessAttention,
  type ReadinessAttention,
  type ReadinessBanner,
  type ReadinessInvitation,
} from "../lib/api/readiness";
import { logger } from "../lib/logger";

/**
 * What the app shell needs from `GET /readiness`: the invitation card and the
 * admin banner (spec 2026-11-14-setup-readiness-design §12). The page itself
 * reads the full response on its own; this store keeps only the two small
 * answers, and never persists them — the server decides, every time.
 *
 * A failed read keeps what is shown. The shell has no room for an error, and
 * a card or banner raised by a broken request is worse than one a little late;
 * the page says it loudly when ITS read fails.
 */
interface ReadinessShellState {
  invitation: ReadinessInvitation | null;
  banner: ReadinessBanner | null;
  /** The header dot and the settings menu's glow (`GET /readiness/attention`). */
  attention: ReadinessAttention | null;
  /** Epoch ms of the last read that was started; drives the focus throttle. */
  lastReadAt: number | null;
  refresh: () => Promise<void>;
  /** Re-read on focus, but not more often than {@link FOCUS_REFRESH_MIN_MS}. */
  refreshOnFocus: (nowMs: number) => Promise<void>;
  /** Optimistic: a snooze succeeded; the next read replaces this either way. */
  hideInvitation: () => void;
  reset: () => void;
}

/** Focus refresh: at most every 10 minutes (§12). */
export const FOCUS_REFRESH_MIN_MS = 10 * 60 * 1000;

// Only the newest read may land; two quick writes start two reads.
let readSeq = 0;

export const useReadinessShellStore = create<ReadinessShellState>((set, get) => ({
  invitation: null,
  banner: null,
  attention: null,
  lastReadAt: null,
  refresh: async () => {
    const mine = ++readSeq;
    set({ lastReadAt: Date.now() });
    // Two reads, two outcomes: a failed card read must not hold back the dot.
    const [view, attention] = await Promise.allSettled([
      fetchReadiness(),
      fetchReadinessAttention(),
    ]);
    if (mine !== readSeq) return;
    if (view.status === "fulfilled") {
      set({ invitation: view.value.invitation, banner: view.value.banner });
    } else {
      logger.debug("readiness shell refresh failed", view.reason);
    }
    if (attention.status === "fulfilled") set({ attention: attention.value });
    else logger.warn("readiness attention read failed", attention.reason);
  },
  refreshOnFocus: async (nowMs) => {
    const last = get().lastReadAt;
    if (last !== null && nowMs - last < FOCUS_REFRESH_MIN_MS) return;
    await get().refresh();
  },
  hideInvitation: () => {
    const current = get().invitation;
    if (current) set({ invitation: { ...current, show: false } });
  },
  reset: () => {
    readSeq++;
    set({ invitation: null, banner: null, attention: null, lastReadAt: null });
  },
}));

/** After any readiness write: the shell re-reads once. Never a loop. */
export function refreshReadinessShell(): Promise<void> {
  return useReadinessShellStore.getState().refresh();
}
