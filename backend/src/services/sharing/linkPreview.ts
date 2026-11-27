import type { DbTransaction } from "../../db";
import { ADAPTERS } from "./adapters";
import { shareableIdsOnTrip } from "./keyOps";
import { labelOf, whenOf, type LinkPlan, type LinkRow } from "./linkMatch";
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

export interface LinkConflictView {
  field: string;
  here: string;
  there: string;
}

export interface LinkMatchView extends LinkEntryView {
  linked: boolean;
  conflicts: LinkConflictView[];
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
  counts: { matched: number; onlyHere: number; onlyThere: number; conflicting: number };
  byType: LinkTypeCount[];
  matched: LinkMatchView[];
  onlyHere: LinkEntryView[];
  onlyThere: LinkEntryView[];
}

const VALUE_CHARS = 80;

/** A fact value as one short line for the dry run. */
export function shortValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  const text = v instanceof Date ? v.toISOString() : typeof v === "string" ? v : JSON.stringify(v);
  return text.length > VALUE_CHARS ? `${text.slice(0, VALUE_CHARS - 1)}…` : text;
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
  const matched = plan.pairs.map((p) => ({
    ...entryView({ entity: p.entity, row: p.here }),
    linked: p.linked,
    conflicts: p.conflicts.map((field) => ({
      field,
      here: shortValue(p.here.facts[field]),
      there: shortValue(p.there.facts[field]),
    })),
  }));
  return {
    here,
    there,
    counts: {
      matched: plan.pairs.length,
      onlyHere: plan.onlyHere.length,
      onlyThere: plan.onlyThere.length,
      conflicting: plan.pairs.filter((p) => p.conflicts.length > 0).length,
    },
    byType: SHARE_ENTITIES.map((entity) => {
      const pairs = plan.pairs.filter((p) => p.entity === entity);
      return {
        entity,
        here: count(hereRows, entity),
        there: count(thereRows, entity),
        matched: pairs.length,
        differing: pairs.filter((p) => p.conflicts.length > 0).length,
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
