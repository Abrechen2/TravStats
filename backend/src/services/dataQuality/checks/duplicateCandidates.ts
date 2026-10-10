import type { RecordCheckDomain } from "../../../schemas/dataQualityRecordChecks";
import type {
  CruiseRecord,
  FlightRecord,
  GroundRecord,
  RecordSnapshot,
  StayRecord,
} from "../recordGather";
import { normaliseKey } from "../recordGather";
import type { DataQualityFinding } from "../types";

/**
 * The same journey or stay entered twice — a mail import beside a hand-typed
 * copy, a booking imported from two mails (forgejo#282).
 *
 * ## What "the same" means, per domain — conservative on purpose
 *
 * A false positive here is worse than a miss: the obvious fix for a duplicate
 * is deleting one, so a question about two genuinely different trips invites
 * the user to delete a real one. Every rule therefore needs the SAME DAY, so a
 * daily commute — the same flight, train or bus every weekday — is never a
 * candidate: two different days are two journeys.
 *
 * - **Flight**: same flight number (case, spaces and leading zeros folded:
 *   "LH 0400" = "LH400"), same departure and arrival airport, same local
 *   departure day. OR, when a number is missing on either side: same route and
 *   the same departure instant to the minute — which needs both times to be
 *   certain real instants (no date-only row, no untagged legacy value). Two
 *   rows that BOTH carry a flight number and differ are never the same flight.
 * - **Train**: same train number, same stations, same local departure day; OR
 *   same stations at the same timed departure minute. Train numbers name one
 *   departure per day, so the day suffices.
 * - **Bus**: same stops at the same timed departure minute only. A line name
 *   is NOT a departure (line 100 runs every twenty minutes), so a bus with a
 *   day and no time of day is never a candidate.
 * - **Cruise**: same ship (catalogue id, else the typed ship name, else the
 *   route name) and the same first AND last day.
 * - **Stay**: same lodging, same check-in day and same check-out day, both at
 *   day precision. Two rooms in the same house over the same nights are a
 *   legitimate case this asks about; that is what "Das stimmt so" is for.
 *
 * Cancelled rows are never candidates: a cancelled booking beside its
 * rebooking is the normal record of what happened.
 *
 * ## Where the flag sits
 *
 * On every copy EXCEPT the earliest-created one (ties by id), so the question
 * stands where the newer entry is and names the others. Deleting a copy makes
 * the group smaller and the flag on it disappears with its row; dismissing
 * says "these are two journeys" for good.
 *
 * Bounded: each domain is one pass that builds hash keys, plus a union-find
 * over the matches — no pairwise comparison.
 */

interface Candidate {
  id: string;
  label: string;
  createdAt: Date;
  dataSource: string | null;
  parentId: string | null;
}

type MatchField = DataQualityFinding & { kind: "duplicate_candidate" };
type Field = MatchField["details"]["matchedOn"][number];

const CANCELLED = "cancelled";
const minuteOf = (at: Date): number => Math.floor(at.getTime() / 60_000);

/** "LH 0400" and "lh400" are one number; anything else is kept, only folded. */
export function normaliseFlightNumber(raw: string | null): string | null {
  const folded = normaliseKey(raw)?.replace(/\s+/g, "") ?? null;
  if (!folded) return null;
  const match = /^([A-Z0-9]{2}[A-Z]?)0*(\d{1,4}[A-Z]?)$/.exec(folded);
  return match ? `${match[1]}${match[2]}` : folded;
}

const airportKey = (end: FlightRecord["dep"]): string | null =>
  normaliseKey(end.iata) ?? normaliseKey(end.icao) ?? normaliseKey(end.name);

/** A tiny union-find over row ids, remembering which fields joined each set. */
class Groups {
  private parent = new Map<string, string>();
  private fields = new Map<string, Set<Field>>();

  private root(id: string): string {
    let node = id;
    while (this.parent.get(node) !== undefined && this.parent.get(node) !== node) {
      node = this.parent.get(node) as string;
    }
    return node;
  }

  join(ids: readonly string[], matchedOn: readonly Field[]): void {
    if (ids.length < 2) return;
    const [first, ...rest] = ids.map((id) => {
      if (!this.parent.has(id)) this.parent.set(id, id);
      return this.root(id);
    });
    const merged = new Set<Field>([...(this.fields.get(first) ?? []), ...matchedOn]);
    for (const other of rest) {
      if (other === first) continue;
      for (const field of this.fields.get(other) ?? []) merged.add(field);
      this.parent.set(other, first);
      this.fields.delete(other);
    }
    this.fields.set(first, merged);
  }

  /** Every group of two or more, with the fields that joined it. */
  sets(): { ids: string[]; matchedOn: Field[] }[] {
    const byRoot = new Map<string, string[]>();
    for (const id of this.parent.keys()) {
      const root = this.root(id);
      byRoot.set(root, [...(byRoot.get(root) ?? []), id]);
    }
    return [...byRoot.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([root, ids]) => ({ ids, matchedOn: [...(this.fields.get(root) ?? [])].sort() }));
  }
}

/**
 * Bucket rows by a key and join every bucket that holds two or more.
 *
 * `consistent` can veto a whole bucket: two DIFFERENT flight numbers at the
 * same minute are a codeshare pair at most, never one row typed twice — and a
 * bucket holding them plus a numberless row is ambiguous, so it is skipped
 * rather than half-joined.
 */
function bucket<T extends { id: string }>(
  groups: Groups,
  rows: readonly T[],
  keyOf: (row: T) => string | null,
  matchedOn: readonly Field[],
  consistent: (members: readonly T[]) => boolean = () => true
): void {
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) continue;
    buckets.set(key, [...(buckets.get(key) ?? []), row]);
  }
  for (const members of buckets.values()) {
    if (members.length < 2 || !consistent(members)) continue;
    groups.join(
      members.map((m) => m.id),
      matchedOn
    );
  }
}

/** At most one distinct non-null value among the members. */
const atMostOne = <T>(values: readonly (T | null)[]): boolean =>
  new Set(values.filter((v) => v !== null)).size <= 1;

function findings(
  domain: RecordCheckDomain,
  groups: Groups,
  byId: ReadonlyMap<string, Candidate>
): DataQualityFinding[] {
  const out: DataQualityFinding[] = [];
  for (const group of groups.sets()) {
    const members = group.ids
      .map((id) => byId.get(id) as Candidate)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));
    for (const member of members.slice(1)) {
      out.push({
        entityType: domain,
        entityId: member.id,
        kind: "duplicate_candidate",
        details: {
          matchedOn: group.matchedOn,
          dataSource: member.dataSource,
          copies: members
            .filter((other) => other.id !== member.id)
            .map((other) => ({
              entityType: domain,
              entityId: other.id,
              label: other.label,
              parentId: other.parentId,
              dataSource: other.dataSource,
              createdAt: other.createdAt.toISOString(),
            })),
        },
      });
    }
  }
  return out;
}

const candidateOf = (row: {
  id: string;
  label: string;
  createdAt: Date;
  dataSource: string | null;
}): Candidate => ({ ...row, parentId: null });

function flightDuplicates(flights: readonly FlightRecord[]): DataQualityFinding[] {
  const live = flights.filter((f) => f.status !== CANCELLED);
  const groups = new Groups();
  const numberOf = (f: FlightRecord) => normaliseFlightNumber(f.flightNumber);
  const route = (f: FlightRecord): string | null => {
    const dep = airportKey(f.dep);
    const arr = airportKey(f.arr);
    return dep && arr ? `${dep}|${arr}` : null;
  };
  bucket(
    groups,
    live,
    (f) =>
      numberOf(f) && route(f) && f.firstDay ? `${numberOf(f)}|${route(f)}|${f.firstDay}` : null,
    ["flightNumber", "route", "departureDay"]
  );
  bucket(
    groups,
    live,
    (f) => (route(f) && f.departureAt ? `${route(f)}|${minuteOf(f.departureAt)}` : null),
    ["route", "departureTime"],
    (members) => atMostOne(members.map(numberOf))
  );
  return findings("flight", groups, new Map(live.map((f) => [f.id, candidateOf(f)])));
}

function groundDuplicates(
  domain: "rail_journey" | "bus_journey",
  rows: readonly GroundRecord[]
): DataQualityFinding[] {
  const live = rows.filter((r) => r.status !== CANCELLED && r.depKey && r.arrKey);
  const groups = new Groups();
  if (domain === "rail_journey") {
    bucket(
      groups,
      live,
      (r) =>
        r.service && r.firstDay ? `${r.service}|${r.depKey}|${r.arrKey}|${r.firstDay}` : null,
      ["trainNumber", "route", "departureDay"]
    );
  }
  bucket(
    groups,
    live,
    (r) => (r.departureAt ? `${r.depKey}|${r.arrKey}|${minuteOf(r.departureAt)}` : null),
    ["route", "departureTime"],
    (members) => atMostOne(members.map((r) => r.service))
  );
  return findings(domain, groups, new Map(live.map((r) => [r.id, candidateOf(r)])));
}

function cruiseDuplicates(cruises: readonly CruiseRecord[]): DataQualityFinding[] {
  const live = cruises.filter((c) => c.status !== CANCELLED);
  const groups = new Groups();
  bucket(
    groups,
    live,
    (c) =>
      c.shipKey && c.firstDay && c.lastDay ? `${c.shipKey}|${c.firstDay}|${c.lastDay}` : null,
    ["ship", "cruiseDates"]
  );
  return findings("cruise", groups, new Map(live.map((c) => [c.id, candidateOf(c)])));
}

function stayDuplicates(stays: readonly StayRecord[]): DataQualityFinding[] {
  const live = stays.filter((s) => s.status !== CANCELLED);
  const groups = new Groups();
  bucket(
    groups,
    live,
    (s) => (s.firstDay && s.lastDay ? `${s.lodgingId}|${s.firstDay}|${s.lastDay}` : null),
    ["lodging", "stayDates"]
  );
  return findings(
    "lodging_stay",
    groups,
    new Map(live.map((s) => [s.id, { ...candidateOf(s), parentId: s.lodgingId }]))
  );
}

export function findDuplicateCandidates(
  snapshot: Pick<RecordSnapshot, "flights" | "railJourneys" | "busJourneys" | "cruises" | "stays">
): DataQualityFinding[] {
  return [
    ...flightDuplicates(snapshot.flights),
    ...groundDuplicates("rail_journey", snapshot.railJourneys),
    ...groundDuplicates("bus_journey", snapshot.busJourneys),
    ...cruiseDuplicates(snapshot.cruises),
    ...stayDuplicates(snapshot.stays),
  ];
}

/**
 * Row ids that share a duplicate group with another row, per domain — so the
 * chronology check does not ask "these two overlap" about a pair this check
 * already asks "is this the same entry twice" about.
 */
export function duplicatePairs(findingsOut: readonly DataQualityFinding[]): Set<string> {
  const pairs = new Set<string>();
  for (const finding of findingsOut) {
    if (finding.kind !== "duplicate_candidate") continue;
    for (const copy of finding.details.copies) {
      pairs.add(`${finding.entityId}|${copy.entityId}`);
      pairs.add(`${copy.entityId}|${finding.entityId}`);
    }
  }
  return pairs;
}
