import { useAuthStore } from "../../../store/authStore";

/**
 * The write queue of the settings area's immediate rows (settings rebuild, B6).
 *
 * One entry per setting, keyed by the setting's id. The entry holds the
 * user's CHOICE next to the last value the server confirmed, which is what
 * makes the three promises of the design hold:
 *
 * - a write that fails does not take the choice away: the row keeps showing
 *   what the user picked, says it was not saved and offers "try again" or
 *   "discard";
 * - discard restores the last SAVED value, not whatever the screen showed;
 * - leaving the page (pagehide, router navigation, the row unmounting) sends
 *   every write still waiting for its debounce, instead of cancelling it.
 *
 * The settings document has its own queue (`store/settingsAutosave`); this one
 * is for rows that write to their own endpoint, or that want a per-row state.
 */
export type WriteState = "idle" | "waiting" | "saving" | "saved" | "failed";

/** Why a write failed. Each has its own DE/EN line under `settings:blocks.save.reason`. */
export type WriteReason = "offline" | "rejected" | "timezone" | "demo" | "notLoaded";

export interface WriteOptions {
  /** The page is going away: the request must survive it. */
  keepalive: boolean;
}

export type WriteFn<T> = (value: T, options: WriteOptions) => Promise<void>;

/** What a write function throws to name its reason itself. */
export class SettingWriteError extends Error {
  constructor(readonly reason: WriteReason) {
    super(reason);
    this.name = "SettingWriteError";
  }
}

export interface WriteEntry<T = unknown> {
  readonly key: string;
  /** What the user chose last. */
  value: T;
  /** What the server last confirmed. */
  saved: T;
  state: WriteState;
  reason: WriteReason | null;
  write: WriteFn<T>;
  timer: ReturnType<typeof setTimeout> | null;
  savedTimer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
}

export const DEBOUNCE_MS = 400;
export const SAVED_VISIBLE_MS = 2500;

const entries = new Map<string, WriteEntry>();
const listeners = new Set<() => void>();
/** A new object per change, so `useSyncExternalStore` sees it. */
let snapshots = new Map<string, WriteEntry>();

function publish(): void {
  snapshots = new Map(Array.from(entries, ([key, entry]) => [key, { ...entry }]));
  listeners.forEach((listener) => listener());
}

export function subscribeWrites(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readWrite<T>(key: string): WriteEntry<T> | undefined {
  return snapshots.get(key) as WriteEntry<T> | undefined;
}

function same(a: unknown, b: unknown): boolean {
  return Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
}

/** Axios-shaped errors, mapped to the reasons the design has copy for. */
export function reasonOf(error: unknown): WriteReason {
  if (error instanceof SettingWriteError) return error.reason;
  const response = (error as { response?: { status?: number } } | null)?.response;
  if (!response) return "offline";
  if (response.status === 403) return "demo";
  return "rejected";
}

function clearTimer(entry: WriteEntry): void {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
}

async function run(entry: WriteEntry, keepalive: boolean): Promise<void> {
  clearTimer(entry);
  if (entry.savedTimer) clearTimeout(entry.savedTimer);
  entry.savedTimer = null;
  // One request per setting at a time: a newer choice made meanwhile is sent
  // when this one returns, in order, so the older can never land last. Only a
  // page that is going away (keepalive) cannot wait for that.
  if (entry.inFlight && !keepalive) return;
  const sent = entry.value;
  entry.inFlight = true;
  entry.state = "saving";
  entry.reason = null;
  publish();
  let failure: WriteReason | null = null;
  try {
    await entry.write(sent, { keepalive });
    entry.saved = sent;
  } catch (error) {
    failure = reasonOf(error);
  }
  entry.inFlight = false;
  // The queue was reset meanwhile (another account signed in): this request
  // belongs to the previous one, and nothing it learned may be acted on.
  if (entries.get(entry.key) !== entry) return;
  if (entry.timer) {
    // A newer choice is waiting for its own debounce: it reports for itself.
    entry.state = "waiting";
  } else if (!same(entry.value, sent)) {
    void run(entry, false);
    return;
  } else if (failure) {
    entry.state = "failed";
    entry.reason = failure;
  } else {
    entry.state = "saved";
    entry.savedTimer = setTimeout(() => {
      entry.savedTimer = null;
      if (entry.state === "saved") {
        entry.state = "idle";
        publish();
      }
    }, SAVED_VISIBLE_MS);
  }
  publish();
}

/**
 * The user chose `value`. `saved` is what the screen showed before: it becomes
 * the entry's last saved value unless a write is already open (then the entry
 * knows better).
 */
export function chooseValue<T>(
  key: string,
  value: T,
  saved: T,
  write: WriteFn<T>,
  debounceMs = DEBOUNCE_MS
): void {
  let entry = entries.get(key) as WriteEntry<T> | undefined;
  if (!entry) {
    entry = {
      key,
      value,
      saved,
      state: "idle",
      reason: null,
      write,
      timer: null,
      savedTimer: null,
      inFlight: false,
    };
    entries.set(key, entry as WriteEntry);
  }
  if (entry.state === "idle" || entry.state === "saved") entry.saved = saved;
  entry.value = value;
  entry.write = write;
  clearTimer(entry as WriteEntry);
  if (same(value, entry.saved) && !entry.inFlight) {
    // Back to the saved value before anything was sent: nothing to write.
    entry.state = "idle";
    publish();
    return;
  }
  entry.state = "waiting";
  entry.reason = null;
  entry.timer = setTimeout(() => void run(entry as WriteEntry, false), debounceMs);
  publish();
}

/** "Erneut versuchen". */
export function retryWrite(key: string): void {
  const entry = entries.get(key);
  if (entry) void run(entry, false);
}

/** "Verwerfen": the last SAVED value comes back. Returns it. */
export function discardWrite<T>(key: string): T | undefined {
  const entry = entries.get(key) as WriteEntry<T> | undefined;
  if (!entry) return undefined;
  clearTimer(entry as WriteEntry);
  entry.value = entry.saved;
  entry.state = "idle";
  entry.reason = null;
  publish();
  return entry.saved;
}

/**
 * Send what is waiting — and retry what failed, once more, because the page is
 * about to take the choice with it. `keepalive` is true on `pagehide`.
 */
export function flushWrites(keepalive = false, onlyKey?: string): void {
  for (const entry of entries.values()) {
    if (onlyKey !== undefined && entry.key !== onlyKey) continue;
    if (entry.state === "waiting" || entry.state === "failed") void run(entry, keepalive);
  }
}

/** Test seam: forget every entry and timer. */
export function resetWriteQueue(): void {
  for (const entry of entries.values()) {
    clearTimer(entry);
    if (entry.savedTimer) clearTimeout(entry.savedTimer);
  }
  entries.clear();
  publish();
}

if (typeof useAuthStore?.subscribe === "function") {
  // Another account must never inherit a choice (or a retry) of the previous one.
  useAuthStore.subscribe((state, previous) => {
    if (state.user?.id !== previous.user?.id) resetWriteQueue();
  });
}

if (typeof window !== "undefined") {
  // Only here is the page really going away; navigation inside the app unmounts rows.
  window.addEventListener("pagehide", () => flushWrites(true));
}
