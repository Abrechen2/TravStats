import { create } from "zustand";
import { logger } from "../lib/logger";
import i18n from "../i18n/config";
import { useRemoteSettingsStatus } from "./remoteSettingsStatus";
import { useSettingsStore } from "./settingsStore";
import { useToastStore } from "./toastStore";

export type AutoSaveState = "idle" | "pending" | "saving" | "saved" | "failed";

/**
 * The settings page's debounced save, kept OUT of the page's lifecycle.
 *
 * The 500 ms timer used to live in a `useEffect` and was cleared on unmount,
 * so an edit followed by navigating to another settings page (or another
 * route) inside that half second was never written, with no message anywhere.
 * Here the timer belongs to the module: leaving the page FLUSHES it instead of
 * cancelling it, and so does `pagehide` (tab close, reload, app switch).
 *
 * `phase` and `reason` are what the page shows: "Wird gespeichert …", or the
 * failure with its reason and a retry. A failure no page is mounted to show
 * falls back to a toast, so it is reported exactly once and never silently.
 */
interface AutosaveState {
  phase: AutoSaveState;
  /** Why the last save failed; null otherwise. */
  reason: string | null;
  /**
   * Whether an edit is still waiting to be sent. A refused general save rolls
   * the screen back to the server's values, and then there is nothing to retry.
   */
  retryable: boolean;
}

export const useSettingsAutosave = create<AutosaveState>(() => ({
  phase: "idle",
  reason: null,
  retryable: false,
}));

const DEBOUNCE_MS = 500;
const SAVED_VISIBLE_MS = 2500;

let timer: ReturnType<typeof setTimeout> | null = null;
let savedTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight = 0;
let observers = 0;

const set = (phase: AutoSaveState, reason: string | null = null): void =>
  useSettingsAutosave.setState({
    phase,
    reason,
    retryable: phase === "failed" && useSettingsStore.getState().hasPendingChanges(),
  });

function reasonOf(error: unknown): string {
  const data = (error as { response?: { data?: { error?: unknown } } } | null)?.response?.data;
  if (typeof data?.error === "string" && data.error) return data.error;
  if (error instanceof Error && error.message) return error.message;
  return i18n.t("settings:errors.saveFailed");
}

/** Report a failure on the page when one is showing, else as a toast. */
function fail(reason: string): void {
  set("failed", reason);
  if (observers === 0) useToastStore.getState().addToast("error", reason);
}

async function run(keepalive = false): Promise<void> {
  timer = null;
  if (savedTimer) clearTimeout(savedTimer);
  const settings = useSettingsStore.getState();
  if (useRemoteSettingsStatus.getState().failed) {
    return fail(i18n.t("settings:errors.loadFailedNoSave"));
  }
  if (!settings.hasPendingChanges()) return set("idle");
  set("saving");
  inFlight += 1;
  try {
    await settings.saveRemoteSettings({ keepalive });
    inFlight -= 1;
    // A newer edit waiting for its own debounce keeps the status on "pending".
    if (timer || inFlight > 0) return;
    set("saved");
    savedTimer = setTimeout(() => {
      if (useSettingsAutosave.getState().phase === "saved") set("idle");
    }, SAVED_VISIBLE_MS);
  } catch (error) {
    inFlight -= 1;
    logger.error("Failed to save settings:", error);
    fail(reasonOf(error));
  }
}

/** An edit happened: (re)start the debounce. */
export function scheduleAutosave(): void {
  if (savedTimer) clearTimeout(savedTimer);
  if (timer) clearTimeout(timer);
  set("pending");
  timer = setTimeout(() => void run(), DEBOUNCE_MS);
}

/** Write a waiting edit now (unmount, navigation, `pagehide`). */
export function flushAutosave(keepalive = false): void {
  if (!timer) return;
  clearTimeout(timer);
  void run(keepalive);
}

/** The user's "Erneut versuchen". */
export function retryAutosave(): void {
  if (timer) clearTimeout(timer);
  void run();
}

/** The settings never loaded, so an edit cannot be saved; say so on the page. */
export function blockAutosave(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  fail(i18n.t("settings:errors.loadFailedNoSave"));
}

/** A page that shows the status registers, so failures are not also toasted. */
export function observeAutosave(): () => void {
  observers += 1;
  return () => {
    observers -= 1;
  };
}

if (typeof window !== "undefined") {
  // Only here is the page really going away; navigation inside the app uses axios.
  window.addEventListener("pagehide", () => flushAutosave(true));
}
