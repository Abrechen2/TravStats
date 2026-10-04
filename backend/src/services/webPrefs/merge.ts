import {
  WEB_PREFS_LIMITS,
  byteLength,
  isWebPrefSection,
  webPrefValueProblem,
  type WebPrefSection,
} from "./sections";

/**
 * Per-section last-write-wins merge for the web preferences (forgejo#200).
 *
 * Pure, so the rule can be tested without a database: the route reads the
 * stored map under a row lock, calls `mergeWebPrefs`, and writes the result.
 */

export interface StoredWebPref {
  value: unknown;
  /** ISO instant the value was last changed, on the device that changed it. */
  updatedAt: string;
}

export type StoredWebPrefs = Partial<Record<WebPrefSection, StoredWebPref>>;

export interface IncomingWebPref {
  value: unknown;
  updatedAt?: string;
}

export type MergeOutcome =
  | {
      ok: true;
      next: StoredWebPrefs;
      /** Sections whose incoming write was older than the stored one — kept as stored. */
      stale: WebPrefSection[];
      /** Section names the server does not know — ignored. */
      dropped: string[];
    }
  | { ok: false; status: 400 | 413; section: string | null; problem: string };

/**
 * Reads what the column holds, keeping only well-formed known sections.
 *
 * The column is written only by `mergeWebPrefs`, so anything else in it came
 * from a hand edit or a future version that was rolled back. Such an entry is
 * skipped rather than served — a client applying it would trust a shape this
 * version never promised.
 */
export function readStoredWebPrefs(raw: unknown): StoredWebPrefs {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: StoredWebPrefs = {};
  for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!isWebPrefSection(name)) continue;
    if (typeof entry !== "object" || entry === null) continue;
    const { value, updatedAt } = entry as Record<string, unknown>;
    if (typeof updatedAt !== "string" || Number.isNaN(Date.parse(updatedAt))) continue;
    if (webPrefValueProblem(name, value) !== null) continue;
    out[name] = { value, updatedAt };
  }
  return out;
}

/**
 * The instant a write is filed under. The device's own clock when it sent
 * one, so an edit made offline and delivered later is ordered by when it was
 * MADE — but never later than the server's now: a device whose clock runs
 * ahead would otherwise win every future conflict.
 */
function stampOf(incoming: string | undefined, now: Date): string {
  if (!incoming) return now.toISOString();
  const at = Date.parse(incoming);
  return new Date(Math.min(at, now.getTime())).toISOString();
}

export function mergeWebPrefs(
  stored: StoredWebPrefs,
  incoming: Record<string, IncomingWebPref>,
  now: Date
): MergeOutcome {
  const next: StoredWebPrefs = { ...stored };
  const stale: WebPrefSection[] = [];
  const dropped: string[] = [];

  for (const [name, entry] of Object.entries(incoming)) {
    if (!isWebPrefSection(name)) {
      dropped.push(name);
      continue;
    }
    const problem = webPrefValueProblem(name, entry.value);
    if (problem !== null) {
      return {
        ok: false,
        status: problem === "is too large" ? 413 : 400,
        section: name,
        problem,
      };
    }
    const updatedAt = stampOf(entry.updatedAt, now);
    const current = stored[name];
    // Equal instants are accepted: a retried write must not report itself stale.
    if (current && Date.parse(updatedAt) < Date.parse(current.updatedAt)) {
      stale.push(name);
      continue;
    }
    next[name] = { value: entry.value, updatedAt };
  }

  if (byteLength(next) > WEB_PREFS_LIMITS.totalMaxBytes) {
    return { ok: false, status: 413, section: null, problem: "the account's total is too large" };
  }
  return { ok: true, next, stale, dropped };
}

/** The newest section stamp, or null when nothing is stored. */
export function latestStamp(prefs: StoredWebPrefs): string | null {
  const times = Object.values(prefs)
    .map((p) => (p ? Date.parse(p.updatedAt) : Number.NaN))
    .filter((t) => Number.isFinite(t));
  return times.length > 0 ? new Date(Math.max(...times)).toISOString() : null;
}
