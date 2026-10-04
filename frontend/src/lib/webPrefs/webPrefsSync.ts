/**
 * Keeps the web app's display preferences in step with the server
 * (forgejo#200). Which preferences, and why, is `registry.ts`; this module is
 * only the engine, and knows nothing about colours or tables.
 *
 * Rules, in the order they matter:
 *
 * 1. **Load once after sign-in; the server wins.** A section the server holds
 *    replaces this device's value. That is the point of the issue — a phone
 *    opened for the first time shows what was chosen on the computer.
 * 2. **The first device seeds; nothing is wiped.** A section the server does
 *    not hold yet, but this device has a non-default value for, is uploaded
 *    instead of being reset.
 * 3. **An edit this device never delivered is not lost.** Every local change
 *    is recorded as pending (persisted, with the instant it was made) until the
 *    server confirms it. A pending change carried over from an earlier visit —
 *    offline, tab closed before the write — is uploaded at the next load if it
 *    is newer than the server's copy. Changes made on THIS page before the
 *    load answered lose to a server copy, because they were made against a
 *    state the user had not seen yet (the stats tab's auto-picked comparison
 *    year is the real case: it would otherwise overwrite the choice from the
 *    other device on every first visit).
 * 4. **Writes are debounced, per changed section, and never roll back.** A
 *    failed write keeps the local value and retries with backoff; a refused
 *    one (400/403/413) keeps the local value and says so once.
 * 5. **No echo.** Applying a server value does not count as a local change,
 *    and a "change" that leaves a section's value as last agreed is ignored.
 * 6. **Nothing is sent after sign-out.** `stop()` cancels every timer and
 *    discards the answer of a request still in flight. Pending changes stay
 *    recorded for the same account; another account discards them.
 */

export interface WebPrefSectionDef {
  /** The server's section name (`backend/src/services/webPrefs/sections.ts`). */
  name: string;
  /** This device's current value, JSON-serialisable. */
  read: () => unknown;
  /** Whether `read()` is only the default — used to decide first-device seeding. */
  isDefault: (value: unknown) => boolean;
  /** Writes a server value into this device's storage and stores. */
  apply: (value: unknown) => void;
  /** Calls back on every local write of this section. Returns the unsubscribe. */
  subscribe: (onChange: () => void) => () => void;
}

export interface StoredSection {
  value: unknown;
  updatedAt: string;
}

export interface WebPrefsState {
  sections: Record<string, StoredSection>;
  updatedAt: string | null;
}

export interface WebPrefsPutResult extends WebPrefsState {
  stale?: string[];
  dropped?: string[];
}

export interface WebPrefsTransport {
  get: () => Promise<WebPrefsState>;
  put: (
    sections: Record<string, { value: unknown; updatedAt: string }>
  ) => Promise<WebPrefsPutResult>;
}

export type WebPrefsFailure = "retrying" | "tooLarge" | "rejected";

export interface WebPrefsSyncOptions {
  sections: readonly WebPrefSectionDef[];
  transport: WebPrefsTransport;
  /** Where pending changes survive a reload — `window.localStorage` in the app. */
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  userId: string;
  /** Told once per kind per page — the UI turns it into a toast. */
  onFailure?: (kind: WebPrefsFailure) => void;
  debounceMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  /** Consecutive transient failures before the user is told. */
  failuresBeforeNotice?: number;
  now?: () => number;
  warn?: (message: string, detail?: unknown) => void;
}

export interface WebPrefsSync {
  start: () => Promise<void>;
  stop: () => void;
  /** Re-reads the server and applies sections changed elsewhere (tab refocus). */
  refresh: () => Promise<void>;
  /** Sends pending changes now instead of after the debounce. */
  flush: () => Promise<void>;
}

/** The key the pending changes are kept under. Per device, never synced. */
export const PENDING_STORAGE_KEY = "travstats.webPrefs.pending.v1";

interface PendingRecord {
  userId: string;
  sections: Record<string, string>;
}

/**
 * JSON with object keys sorted, so two equal values compare equal however
 * their keys were ordered — Postgres `jsonb` reorders them on the way back.
 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function statusOf(error: unknown): number | null {
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === "number" ? status : null;
}

export function createWebPrefsSync(options: WebPrefsSyncOptions): WebPrefsSync {
  const {
    sections,
    transport,
    storage,
    userId,
    onFailure,
    debounceMs = 1500,
    retryBaseMs = 2000,
    retryMaxMs = 60_000,
    failuresBeforeNotice = 3,
    now = () => Date.now(),
    warn = () => undefined,
  } = options;
  const byName = new Map(sections.map((s) => [s.name, s]));

  let active = false;
  let generation = 0;
  let loaded = false;
  let applying = false;
  let inFlight = false;
  let failures = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribers: Array<() => void> = [];
  const told = new Set<WebPrefsFailure>();
  /** What this device and the server last agreed a section is. */
  const agreed = new Map<string, string>();
  /** Section → instant of the newest local change the server has not confirmed. */
  let pending: Record<string, string> = {};
  /** Pending changes from an earlier page, read at `start`. */
  let carried: Record<string, string> = {};

  const iso = () => new Date(now()).toISOString();

  function tell(kind: WebPrefsFailure): void {
    if (told.has(kind)) return;
    told.add(kind);
    onFailure?.(kind);
  }

  function readPending(): Record<string, string> {
    try {
      const raw = storage.getItem(PENDING_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Partial<PendingRecord>;
      // Another account's unsent edits must never reach this account.
      if (parsed.userId !== userId || typeof parsed.sections !== "object" || !parsed.sections) {
        return {};
      }
      return Object.fromEntries(
        Object.entries(parsed.sections).filter(
          ([name, at]) =>
            byName.has(name) && typeof at === "string" && !Number.isNaN(Date.parse(at))
        )
      );
    } catch {
      return {};
    }
  }

  function writePending(): void {
    try {
      if (Object.keys(pending).length === 0) storage.removeItem(PENDING_STORAGE_KEY);
      else storage.setItem(PENDING_STORAGE_KEY, JSON.stringify({ userId, sections: pending }));
    } catch {
      // Storage blocked: the change is still sent this page, it just cannot
      // outlive a reload.
    }
  }

  function clearTimer(timer: ReturnType<typeof setTimeout> | null): null {
    if (timer) clearTimeout(timer);
    return null;
  }

  function scheduleFlush(delay: number): void {
    debounceTimer = clearTimer(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void flush();
    }, delay);
  }

  function onLocalChange(name: string): void {
    if (!active || applying) return;
    const section = byName.get(name);
    if (!section) return;
    if (loaded) {
      const local = section.read();
      if (stableStringify(local) === agreed.get(name)) return;
      // Nothing on the server and nothing chosen here: a map writing its
      // defaults on mount is not a choice, and uploading it would make those
      // defaults overwrite a customised device at its next load.
      if (!agreed.has(name) && section.isDefault(local)) return;
    }
    pending = { ...pending, [name]: iso() };
    writePending();
    // Before the load has answered there is nothing to compare against; the
    // load decides (rule 3) and flushes what is left.
    if (loaded && !retryTimer) scheduleFlush(debounceMs);
  }

  function applyServer(name: string, value: unknown): void {
    const section = byName.get(name);
    if (!section) return;
    if (stableStringify(section.read()) !== stableStringify(value)) {
      applying = true;
      try {
        section.apply(value);
      } catch (error) {
        warn(`web prefs: could not apply section ${name}`, error);
      } finally {
        applying = false;
      }
    }
    agreed.set(name, stableStringify(section.read()));
  }

  function withoutPending(name: string): void {
    if (!(name in pending)) return;
    const next = { ...pending };
    delete next[name];
    pending = next;
  }

  function reconcile(state: WebPrefsState, initial: boolean): void {
    for (const section of sections) {
      const { name } = section;
      const server = state.sections[name];
      if (initial) {
        if (!server) {
          // Rule 2: nothing on the server yet — seed it from a real choice,
          // and say nothing about a default.
          const local = section.read();
          if (section.isDefault(local)) withoutPending(name);
          else if (!(name in pending)) pending = { ...pending, [name]: iso() };
          continue;
        }
        const carriedAt = carried[name];
        if (carriedAt !== undefined && Date.parse(carriedAt) > Date.parse(server.updatedAt)) {
          // Rule 3: an undelivered edit newer than the server's copy. Keep it
          // pending (with the newer of its instants) and upload it.
          agreed.set(name, stableStringify(server.value));
          continue;
        }
        withoutPending(name);
        applyServer(name, server.value);
        continue;
      }
      // A refresh: adopt what another device changed, unless this device has
      // an edit of its own in the pipeline — the PUT settles that one.
      if (!server || name in pending) continue;
      if (stableStringify(server.value) !== agreed.get(name)) applyServer(name, server.value);
    }
  }

  async function load(gen: number): Promise<void> {
    try {
      const state = await transport.get();
      if (gen !== generation || !active) return;
      reconcile(state, true);
      loaded = true;
      failures = 0;
      carried = {};
      writePending();
      if (Object.keys(pending).length > 0) await flush();
    } catch (error) {
      if (gen !== generation || !active) return;
      if (statusOf(error) === 401) return; // the session is gone; sign-out follows
      failures += 1;
      warn("web prefs: could not load from the server", error);
      if (failures >= failuresBeforeNotice) tell("retrying");
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void load(gen);
      }, backoff());
    }
  }

  function backoff(): number {
    return Math.min(retryBaseMs * 2 ** Math.max(0, failures - 1), retryMaxMs);
  }

  async function flush(): Promise<void> {
    debounceTimer = clearTimer(debounceTimer);
    if (!active || !loaded || inFlight) return;
    const names = Object.keys(pending);
    if (names.length === 0) return;

    const gen = generation;
    const sent: Record<string, { value: unknown; updatedAt: string }> = {};
    const sentJson = new Map<string, string>();
    for (const name of names) {
      const value = byName.get(name)!.read();
      sent[name] = { value, updatedAt: pending[name] };
      sentJson.set(name, stableStringify(value));
    }

    inFlight = true;
    try {
      const result = await transport.put(sent);
      if (gen !== generation || !active) return; // signed out meanwhile
      failures = 0;
      const stale = new Set(result.stale ?? []);
      for (const name of names) {
        const unchangedSince = pending[name] === sent[name].updatedAt;
        if (stale.has(name)) {
          // The server holds a newer value from another device. Adopt it,
          // unless the user has changed this section again since sending —
          // that newer edit gets its own write.
          const server = result.sections[name];
          if (unchangedSince) {
            withoutPending(name);
            if (server) applyServer(name, server.value);
          }
          continue;
        }
        agreed.set(name, sentJson.get(name)!);
        if (unchangedSince) withoutPending(name);
      }
      for (const name of result.dropped ?? []) {
        warn(`web prefs: the server does not know section ${name}`);
        withoutPending(name);
      }
      writePending();
    } catch (error) {
      if (gen !== generation || !active) return;
      const status = statusOf(error);
      if (status === 401) return;
      if (status === 400 || status === 403 || status === 413) {
        // Refused, and a retry would be refused again. The local value stays;
        // it simply does not follow the user.
        warn(`web prefs: the server refused the write (${status})`, error);
        for (const name of names) {
          if (pending[name] === sent[name].updatedAt) withoutPending(name);
        }
        writePending();
        tell(status === 413 ? "tooLarge" : "rejected");
        return;
      }
      failures += 1;
      warn("web prefs: could not save to the server, will retry", error);
      if (failures >= failuresBeforeNotice) tell("retrying");
      retryTimer = clearTimer(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void flush();
      }, backoff());
    } finally {
      inFlight = false;
      if (active && gen === generation && failures === 0 && Object.keys(pending).length > 0) {
        scheduleFlush(debounceMs);
      }
    }
  }

  async function start(): Promise<void> {
    if (active) return;
    active = true;
    generation += 1;
    loaded = false;
    failures = 0;
    agreed.clear();
    carried = readPending();
    pending = { ...carried };
    writePending();
    unsubscribers = sections.map((s) => s.subscribe(() => onLocalChange(s.name)));
    await load(generation);
  }

  function stop(): void {
    if (!active) return;
    active = false;
    generation += 1;
    debounceTimer = clearTimer(debounceTimer);
    retryTimer = clearTimer(retryTimer);
    for (const unsubscribe of unsubscribers) unsubscribe();
    unsubscribers = [];
  }

  async function refresh(): Promise<void> {
    if (!active || !loaded) return;
    const gen = generation;
    try {
      const state = await transport.get();
      if (gen !== generation || !active) return;
      reconcile(state, false);
    } catch (error) {
      // A refresh is a courtesy; the next one, or the next load, will do.
      warn("web prefs: refresh failed", error);
    }
  }

  return { start, stop, refresh, flush };
}
