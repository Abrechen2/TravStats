/**
 * The proposal snapshot and the pure rules for laying it onto a flight: how
 * an edit merges into a proposal, what counts as a change, and which proposed
 * fields an apply may still write. Split out of `pendingUpdateService.ts`,
 * which is held under the 800-line limit.
 */

/** Flight data fields used for original/proposed data snapshots */
export interface FlightDataSnapshot {
  airline?: string | null;
  aircraft?: string | null;
  gate?: string | null;
  terminal?: string | null;
  depIata?: string | null;
  depIcao?: string | null;
  depName?: string | null;
  arrIata?: string | null;
  arrIcao?: string | null;
  arrName?: string | null;
  departureTime?: string | null;
  arrivalTime?: string | null;
  /** Actual off-block time (UTC ISO); populated when an API reports it */
  actualDeparture?: string | null;
  /** Actual on-block time (UTC ISO); populated when an API reports it */
  actualArrival?: string | null;
  status?: string | null;
  actualRoute?: unknown;
  overflownCountries?: string[] | null;
  routeDistance?: number | null;
}

/** A single change entry between original and proposed data */
export interface ChangeEntry {
  field: string;
  oldValue: string | number | boolean | null | undefined;
  newValue: string | number | boolean | null | undefined;
  type: "added" | "removed" | "changed";
}

/** The proposal with the user's edits laid over it; an absent key keeps the proposal's value. */
export function proposalWithEdits(
  proposed: FlightDataSnapshot | null,
  edited: FlightDataSnapshot | null | undefined
): FlightDataSnapshot {
  const edits = Object.fromEntries(
    Object.entries(edited ?? {}).filter(([, value]) => value !== undefined)
  ) as FlightDataSnapshot;
  return { ...(proposed ?? {}), ...edits };
}

/**
 * Calculate changes between two data objects
 */
export function calculateChanges(
  original: FlightDataSnapshot,
  proposed: FlightDataSnapshot
): ChangeEntry[] {
  const changes: ChangeEntry[] = [];
  const allKeys = new Set([...Object.keys(original), ...Object.keys(proposed)]);

  for (const field of allKeys) {
    const oldValue = (original as Record<string, unknown>)[field];
    const newValue = (proposed as Record<string, unknown>)[field];

    if (oldValue !== newValue) {
      changes.push({
        field,
        oldValue: oldValue as ChangeEntry["oldValue"],
        newValue: newValue as ChangeEntry["newValue"],
        type: oldValue === undefined ? "added" : newValue === undefined ? "removed" : "changed",
      });
    }
  }

  return changes;
}

/**
 * Fields written as a consequence of another one, and the field they follow.
 * Applying a coordinate while refusing the airport it belongs to would produce
 * a flight that contradicts itself.
 */
const DERIVED_FIELDS: Record<string, string> = {
  depLat: "depIata",
  depLon: "depIata",
  arrLat: "arrIata",
  arrLon: "arrIata",
  delayMinutes: "actualDeparture",
};

/** Fields that describe the UPDATE itself rather than the flight's data. */
const PROVENANCE_FIELDS = new Set([
  "dataSource",
  "lastModifiedBy",
  "routeSource",
  "hasLiveTracking",
  "enrichmentHistory",
  "depTimeSemantics",
  "arrTimeSemantics",
]);

/** Compare a stored value with its snapshot form — dates arrive as strings. */
export function sameStoredValue(current: unknown, snapshot: unknown): boolean {
  if (current instanceof Date) {
    if (snapshot === null || snapshot === undefined) return false;
    const asDate = new Date(String(snapshot));
    return !Number.isNaN(asDate.getTime()) && asDate.getTime() === current.getTime();
  }
  if (current === null || current === undefined) {
    return snapshot === null || snapshot === undefined;
  }
  return current === snapshot;
}

/**
 * Narrow `updateData` in place to the fields this suggestion actually proposes
 * AND that the user has not changed since it was made. Returns the names it
 * removed for a conflict, so the caller can say so.
 *
 * A suggestion with no recorded change list is applied whole, as before —
 * refusing it would break every row written before `changes` existed.
 */
export function restrictToUncontestedProposal(
  updateData: Record<string, unknown>,
  changes: ChangeEntry[] | null,
  originalData: FlightDataSnapshot | null,
  flight: Record<string, unknown>
): string[] {
  if (!Array.isArray(changes) || changes.length === 0) return [];

  const proposed = new Set(changes.map((c) => c.field));
  const original = (originalData ?? {}) as Record<string, unknown>;
  const conflicted: string[] = [];

  for (const key of Object.keys(updateData)) {
    if (PROVENANCE_FIELDS.has(key)) continue;

    const governing = DERIVED_FIELDS[key] ?? key;
    if (!proposed.has(governing)) {
      // Never proposed: leave whatever the flight says today.
      delete updateData[key];
      continue;
    }
    if (originalData && !sameStoredValue(flight[governing], original[governing])) {
      // Proposed, but the user has since written something else here. Their
      // edit is the more recent statement of intent, so it stands.
      conflicted.push(governing);
      delete updateData[key];
    }
  }

  return [...new Set(conflicted)];
}
