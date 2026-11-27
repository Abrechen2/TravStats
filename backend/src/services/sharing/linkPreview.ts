import type { DbTransaction } from "../../db";
import { ADAPTERS } from "./adapters";
import { shareableIdsOnTrip } from "./keyOps";
import type { FactRecord } from "./factValues";
import { labelOf, whenOf, type LinkPair, type LinkPlan, type LinkRow } from "./linkMatch";
import {
  groupConflicts,
  lineView,
  pairIsAutomatic,
  type FactGroup,
  type LineView,
} from "./linkResolve";
import { pairRef } from "./linkSettle";
import { display, type DisplayValue } from "./noticeChanges";
import { SHARE_ENTITIES, type ShareEntity } from "./shareTypes";

/**
 * The dry run of linking an existing copy (forgejo#440), as the person reads it before deciding:
 * per type how many entries each side holds, which entries were matched (and in which facts they
 * disagree), which are only here and which only there. Shared by the local and the federated
 * path; nothing here writes.
 */

export interface LinkTripView {
  id: string;
  name: string;
  startDay: string | null;
  endDay: string | null;
}

/** Why a trip is offered as the counterpart: same period, same name, or overlapping dates. */
export type LinkCandidateReason = "period" | "name" | "overlap";

export interface LinkCandidate extends LinkTripView {
  reason: LinkCandidateReason;
}

export interface LinkEntryView {
  entity: ShareEntity;
  label: string;
  when: string | null;
}

/** A differing value as the dry run shows it: a display value, or a line by its quality. */
export type LinkValue = DisplayValue | ({ kind: "line" } & LineView);

export interface LinkConflictView {
  /** The group: a fact's name, or the name of the facts decided together (`geometry`, `checkIn`). */
  field: string;
  here: LinkValue;
  there: LinkValue;
  /** The side whose value is better (filled, drawn, more precise); null when equal. */
  better: "here" | "there" | null;
  /** Both hold a value of the same quality: the person decides, the rule cannot. */
  real: boolean;
}

export interface LinkMatchView extends LinkEntryView {
  /** How the link names this pair in `choices`. */
  ref: string;
  linked: boolean;
  conflicts: LinkConflictView[];
  /** Differing facts the server computes again (distance, CO₂) or the transfer cannot carry. */
  recomputed: string[];
  /** No difference needs the person. */
  automatic: boolean;
}

export interface LinkTypeCount {
  entity: ShareEntity;
  here: number;
  there: number;
  matched: number;
  /** Matched entries whose facts differ. */
  differing: number;
}

export interface LinkPreview {
  here: LinkTripView;
  there: LinkTripView;
  counts: {
    matched: number;
    onlyHere: number;
    onlyThere: number;
    conflicting: number;
    /** Pairs with a difference only the person can settle. */
    needsReview: number;
  };
  /** The trip can be linked by the quality rule alone (the bulk link takes it). */
  automatic: boolean;
  byType: LinkTypeCount[];
  matched: LinkMatchView[];
  onlyHere: LinkEntryView[];
  onlyThere: LinkEntryView[];
}

/** A house as one line: its name and place. */
function houseText(v: unknown): DisplayValue {
  const h = (v ?? {}) as { name?: unknown; city?: unknown };
  const parts = [h.name, h.city].filter((p): p is string => typeof p === "string" && p !== "");
  return parts.length > 0 ? { kind: "text", value: parts.join(", ") } : { kind: "empty" };
}

const TIME_ZONE_OF: Record<string, string> = {
  departureTime: "depTimezone",
  arrivalTime: "arrTimezone",
  pickupTime: "pickupTimezone",
  returnTime: "returnTimezone",
  actualPickupTime: "pickupTimezone",
  actualReturnTime: "returnTimezone",
  checkInAt: "stayZone",
  checkOutAt: "stayZone",
  checkInDate: "stayZone",
  checkOutDate: "stayZone",
  startUtc: "stopZone",
  endUtc: "stopZone",
};

/** The zone a time fact is read in: the row's own, else the zone fact beside it. */
function zonesFor(facts: FactRecord, rowZones: Record<string, string | null>) {
  const out: Record<string, string | null> = { ...rowZones };
  for (const [field, zoneField] of Object.entries(TIME_ZONE_OF)) {
    const z = facts[zoneField];
    if (out[field] == null && typeof z === "string" && z !== "") out[field] = z;
  }
  return out;
}

/** One side of a differing group, formatted in the place's zone (ADR 0002). */
function groupValue(
  group: FactGroup,
  facts: FactRecord,
  zones: Record<string, string | null>
): LinkValue {
  if (group.kind === "line") return { kind: "line", ...lineView(group, facts) };
  const z = zonesFor(facts, zones);
  if (group.id === "checkIn" || group.id === "checkOut") {
    const [at, date] = group.fields;
    const field = facts[at as string] ? (at as string) : (date as string);
    return display(field, facts[field], z, facts);
  }
  const field = group.fields[0] as string;
  if (field === "lodging") return houseText(facts.lodging);
  return display(field, facts[field], z, facts);
}

function matchView(p: LinkPair): LinkMatchView {
  const { groups, recomputed, uncarried } = groupConflicts(
    p.entity,
    p.conflicts,
    p.here.facts,
    p.there.facts
  );
  // A row decoded from the wire carries no zones; the same entry is at the same place.
  const zones = { ...p.there.zones, ...p.here.zones };
  return {
    ...entryView({ entity: p.entity, row: p.here }),
    ref: pairRef(p),
    linked: p.linked,
    conflicts: groups.map((g) => ({
      field: g.group.id,
      here: groupValue(g.group, p.here.facts, zones),
      there: groupValue(g.group, p.there.facts, zones),
      better: g.better,
      real: g.real,
    })),
    recomputed: [...recomputed, ...uncarried],
    automatic: pairIsAutomatic(p.entity, p.conflicts, p.here.facts, p.there.facts),
  };
}

const dayOf = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

export function tripView(t: {
  id: string;
  name: string;
  startDay: Date | null;
  endDay: Date | null;
}): LinkTripView {
  return { id: t.id, name: t.name, startDay: dayOf(t.startDay), endDay: dayOf(t.endDay) };
}

const entryView = (r: LinkRow): LinkEntryView => ({
  entity: r.entity,
  label: labelOf(r.entity, r.row),
  when: whenOf(r.entity, r.row.facts),
});

export function describePlan(
  plan: LinkPlan,
  here: LinkTripView,
  there: LinkTripView,
  hereRows: readonly LinkRow[],
  thereRows: readonly LinkRow[]
): LinkPreview {
  const count = (rows: readonly LinkRow[], e: ShareEntity) =>
    rows.filter((r) => r.entity === e && !r.row.excluded).length;
  const matched = plan.pairs.map(matchView);
  const needsReview = matched.filter((m) => !m.automatic).length;
  return {
    here,
    there,
    counts: {
      matched: plan.pairs.length,
      onlyHere: plan.onlyHere.length,
      onlyThere: plan.onlyThere.length,
      conflicting: matched.filter((m) => m.conflicts.length > 0).length,
      needsReview,
    },
    // Nothing matched is nothing to link by rule: the person looks at it.
    automatic: matched.length > 0 && needsReview === 0,
    byType: SHARE_ENTITIES.map((entity) => {
      const pairs = plan.pairs.filter((p) => p.entity === entity);
      return {
        entity,
        here: count(hereRows, entity),
        there: count(thereRows, entity),
        matched: pairs.length,
        differing: matched.filter((m) => m.ref.startsWith(`${entity}:`) && m.conflicts.length > 0)
          .length,
      };
    }).filter((t) => t.here > 0 || t.there > 0),
    matched,
    onlyHere: plan.onlyHere.map(entryView),
    onlyThere: plan.onlyThere.map(entryView),
  };
}

/** Every shareable entry of one trip, keyed or not, as the matcher reads it. */
export async function tripRows(
  c: DbTransaction,
  ownerId: string,
  tripId: string
): Promise<LinkRow[]> {
  const out: LinkRow[] = [];
  for (const entity of SHARE_ENTITIES) {
    const ids = await shareableIdsOnTrip(c, entity, ownerId, tripId);
    if (ids.length === 0) continue;
    for (const row of await ADAPTERS[entity].load(c, ids)) out.push({ entity, row });
  }
  return out;
}

const MAX_CANDIDATES = 5;
const REASON_RANK: Record<LinkCandidateReason, number> = { period: 0, name: 1, overlap: 2 };
const normName = (s: string) => s.trim().toLocaleLowerCase("de");

/**
 * The trips of the other side that may be the same trip: the same period first, then the same
 * name, then overlapping dates — at most five. A trip that matches on nothing is not offered: the
 * other account's trip list is not browsed.
 */
export function rankCandidates(
  source: LinkTripView,
  trips: readonly LinkTripView[]
): LinkCandidate[] {
  const out: LinkCandidate[] = [];
  for (const t of trips) {
    const period =
      source.startDay !== null && source.startDay === t.startDay && source.endDay === t.endDay;
    const name = normName(source.name) !== "" && normName(source.name) === normName(t.name);
    const overlap =
      source.startDay !== null &&
      source.endDay !== null &&
      t.startDay !== null &&
      t.endDay !== null &&
      t.startDay <= source.endDay &&
      source.startDay <= t.endDay;
    const reason: LinkCandidateReason | null = period
      ? "period"
      : name
        ? "name"
        : overlap
          ? "overlap"
          : null;
    if (reason) out.push({ ...t, reason });
  }
  return out
    .sort(
      (a, b) =>
        REASON_RANK[a.reason] - REASON_RANK[b.reason] ||
        (a.startDay ?? "").localeCompare(b.startDay ?? "")
    )
    .slice(0, MAX_CANDIDATES);
}
