import { createHash } from "crypto";

import { rankDestinations, type DestinationEvidence } from "../../routes/trips/entrySuggestions";
import { haversineKm } from "../../shared/geo/haversine";
import {
  AWAY_KM,
  MIN_NEW_TRIP_ENTRIES,
  MIN_NIGHTS_AWAY,
  TRIP_DERIVED_WINDOW_MAX_DAYS,
  TRIP_PLAUSIBLE_KM,
  TRIP_WINDOW_PAD_DAYS,
  isMaterialChange,
} from "../../shared/tripSuggestionRules";
import { addDays, dayDiff } from "./time";
import type { Absence } from "./absences";
import type {
  HomeAt,
  LinkableDomain,
  PresenceEntry,
  SuggestionKind,
  SuggestionMember,
  TripContext,
  TripSuggestion,
} from "./types";

/**
 * From absences to proposals: a new trip, entries that belong to a trip the
 * account already has, or a trip that the entries would stretch.
 *
 * It proposes. It never writes — accepting is `accept.ts`, one transaction the
 * user starts.
 */

/** A previous answer, as `decisions.ts` loads it. */
export interface AnsweredProposal {
  kind: SuggestionKind;
  fingerprint: string;
  targetId: string | null;
  memberKeys: readonly string[];
}

const minDay = (a: string, b: string): string => (a < b ? a : b);
const maxDay = (a: string, b: string): string => (a > b ? a : b);

/** Stable id: kind, target and the sorted member set. */
export function proposalId(
  kind: SuggestionKind,
  targetId: string | null,
  memberKeys: readonly string[]
): string {
  const digest = createHash("sha1")
    .update([...memberKeys].sort().join("|"))
    .digest("hex")
    .slice(0, 16);
  return `${kind}:${targetId ?? "-"}:${digest}`;
}

function toMember(entry: PresenceEntry): SuggestionMember {
  return {
    key: entry.key,
    domain: entry.domain as LinkableDomain,
    id: entry.id,
    label: entry.label,
    startDay: entry.startDay,
    endDay: entry.endDay,
    planned: entry.state === "planned",
  };
}

/**
 * The destination's name, from the AWAY ends of the members only — a return
 * flight's arrival city is home and would otherwise outvote the hotel. The
 * ranking is the trip form's (`rankDestinations`): most frequent city, and a
 * country once two of its cities are named.
 */
export function destinationOf(entries: readonly PresenceEntry[], homeAt: HomeAt): string | null {
  const evidence: DestinationEvidence[] = [];
  for (const entry of entries) {
    if (!entry.pointCities) {
      evidence.push({ city: entry.city, country: entry.country });
      continue;
    }
    entry.points.forEach((point, i) => {
      const home = homeAt(point.day);
      if (home !== null && haversineKm(home, point) <= AWAY_KM) return;
      evidence.push({ city: entry.pointCities?.[i] ?? null, country: entry.country });
    });
  }
  return rankDestinations(evidence, 1)[0] ?? null;
}

interface TripSpan {
  startDay: string;
  endDay: string;
  /** Whether the span may serve as a date window (`TRIP_DERIVED_WINDOW_MAX_DAYS`). */
  window: boolean;
}

/** A trip's span: its own dates, widened by everything already linked to it. */
export function tripSpans(
  trips: readonly TripContext[],
  entries: readonly PresenceEntry[]
): Map<string, TripSpan> {
  const spans = new Map<string, TripSpan>();
  const ownDates = new Set(trips.filter((t) => t.startDay || t.endDay).map((t) => t.id));
  const widen = (id: string, start: string, end: string): void => {
    const seen = spans.get(id);
    const startDay = seen ? minDay(seen.startDay, start) : start;
    const endDay = seen ? maxDay(seen.endDay, end) : end;
    spans.set(id, {
      startDay,
      endDay,
      window: ownDates.has(id) || dayDiff(startDay, endDay) <= TRIP_DERIVED_WINDOW_MAX_DAYS,
    });
  };
  for (const trip of trips) {
    const start = trip.startDay ?? trip.endDay;
    const end = trip.endDay ?? trip.startDay;
    if (start && end) widen(trip.id, start, end);
  }
  const known = new Set(trips.map((t) => t.id));
  for (const entry of entries) {
    if (entry.tripId && known.has(entry.tripId)) widen(entry.tripId, entry.startDay, entry.endDay);
  }
  return spans;
}

const overlapDays = (
  a: { startDay: string; endDay: string },
  b: { startDay: string; endDay: string }
): number => {
  const start = maxDay(a.startDay, b.startDay);
  const end = minDay(a.endDay, b.endDay);
  return start > end ? 0 : dayDiff(start, end) + 1;
};

/** The existing trip an absence belongs to, if any: the one it shares entries or days with most. */
function tripFor(absence: Absence, spans: Map<string, TripSpan>): string | null {
  const byMembers = new Map<string, number>();
  for (const entry of absence.entries) {
    if (entry.tripId && spans.has(entry.tripId)) {
      byMembers.set(entry.tripId, (byMembers.get(entry.tripId) ?? 0) + 1);
    }
  }
  const ranked = [...byMembers.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length > 0) return ranked[0][0];

  let best: { id: string; days: number } | null = null;
  for (const [id, span] of spans) {
    if (!span.window) continue;
    const window = {
      startDay: addDays(span.startDay, -TRIP_WINDOW_PAD_DAYS),
      endDay: addDays(span.endDay, TRIP_WINDOW_PAD_DAYS),
    };
    const days = overlapDays(window, absence);
    if (days > 0 && (best === null || days > best.days)) best = { id, days };
  }
  return best?.id ?? null;
}

function base(
  kind: SuggestionKind,
  targetId: string | null,
  members: readonly PresenceEntry[],
  homeAt: HomeAt
): Pick<TripSuggestion, "id" | "kind" | "planned" | "destination" | "members"> {
  return {
    id: proposalId(
      kind,
      targetId,
      members.map((m) => m.key)
    ),
    kind,
    planned: members.every((m) => m.state === "planned"),
    destination: destinationOf(members, homeAt),
    members: [...members].sort((a, b) => a.startDay.localeCompare(b.startDay)).map(toMember),
  };
}

/** New-trip, assign and extend proposals for every absence. */
export function proposalsFromAbsences(
  absences: readonly Absence[],
  trips: readonly TripContext[],
  entries: readonly PresenceEntry[],
  homeAt: HomeAt
): TripSuggestion[] {
  const spans = tripSpans(trips, entries);
  const tripById = new Map(trips.map((t) => [t.id, t]));
  const out: TripSuggestion[] = [];

  for (const absence of absences) {
    const tripless = absence.entries.filter((e) => e.linkable && e.tripId === null);
    if (tripless.length === 0) continue;
    const signals = [...absence.signals].sort();
    const tripId = tripFor(absence, spans);

    if (tripId !== null) {
      const span = spans.get(tripId)!;
      const window = {
        startDay: addDays(span.startDay, -TRIP_WINDOW_PAD_DAYS),
        endDay: addDays(span.endDay, TRIP_WINDOW_PAD_DAYS),
      };
      const stretches = tripless.some(
        (e) => e.startDay < window.startDay || e.endDay > window.endDay
      );
      const kind = stretches ? "extend" : "assign";
      const startDay = tripless.map((e) => e.startDay).reduce(minDay);
      const endDay = tripless.map((e) => e.endDay).reduce(maxDay);
      out.push({
        ...base(kind, tripId, tripless, homeAt),
        startDay,
        endDay,
        nights: absence.nights,
        signals,
        zoneUnknown: absence.entries.filter((e) => e.zoneUnknown).length,
        trip: tripById.get(tripId),
        ...(stretches && {
          newSpan: {
            startDay: minDay(span.startDay, startDay),
            endDay: maxDay(span.endDay, endDay),
          },
        }),
      });
      continue;
    }

    if (absence.nights < MIN_NIGHTS_AWAY || tripless.length < MIN_NEW_TRIP_ENTRIES) continue;
    out.push({
      ...base("new_trip", null, tripless, homeAt),
      startDay: absence.startDay,
      endDay: absence.endDay,
      nights: absence.nights,
      signals,
      zoneUnknown: absence.entries.filter((e) => e.zoneUnknown).length,
    });
  }
  return out;
}

/**
 * Trip-less entries no absence could place — home unknown for their days —
 * that sit inside a trip's window AND within reach of something the trip
 * already holds. Without the distance check every entry in the same fortnight
 * as a trip would be offered to it.
 */
export function proposalsByWindow(
  unplaced: readonly PresenceEntry[],
  trips: readonly TripContext[],
  entries: readonly PresenceEntry[],
  homeAt: HomeAt
): TripSuggestion[] {
  const spans = tripSpans(trips, entries);
  const tripById = new Map(trips.map((t) => [t.id, t]));
  const reachByTrip = new Map<string, PresenceEntry["points"][number][]>();
  for (const e of entries) {
    if (e.tripId) reachByTrip.set(e.tripId, [...(reachByTrip.get(e.tripId) ?? []), ...e.points]);
  }
  const byTrip = new Map<string, PresenceEntry[]>();
  for (const entry of unplaced) {
    if (!entry.linkable || entry.tripId !== null) continue;
    for (const [tripId, span] of spans) {
      if (!span.window) continue;
      const start = addDays(span.startDay, -TRIP_WINDOW_PAD_DAYS);
      const end = addDays(span.endDay, TRIP_WINDOW_PAD_DAYS);
      if (entry.startDay < start || entry.endDay > end) continue;
      const reach = reachByTrip.get(tripId) ?? [];
      const near = entry.points.some((p) =>
        reach.some((r) => haversineKm(r, p) <= TRIP_PLAUSIBLE_KM)
      );
      if (!near) continue;
      byTrip.set(tripId, [...(byTrip.get(tripId) ?? []), entry]);
      break;
    }
  }
  return [...byTrip.entries()].map(([tripId, members]) => ({
    ...base("assign", tripId, members, homeAt),
    startDay: members.map((e) => e.startDay).reduce(minDay),
    endDay: members.map((e) => e.endDay).reduce(maxDay),
    nights: null,
    signals: [],
    zoneUnknown: members.filter((e) => e.zoneUnknown).length,
    trip: tripById.get(tripId),
  }));
}

/**
 * Drop what the user already answered, unless it has materially changed.
 *
 * A place visit is matched by its id (place and anchor). A trip proposal is
 * matched by FAMILY — a new trip against new trips, a link against links to the
 * same trip — and by member overlap (`isMaterialChange`), because its id moves
 * with every entry added or removed. Accepted answers count too: a user who
 * accepted a trip and then deleted it has answered the question twice.
 */
export function withoutAnswered(
  proposals: readonly TripSuggestion[],
  answered: readonly AnsweredProposal[]
): TripSuggestion[] {
  return proposals.filter((p) => {
    const keys = p.members.map((m) => m.key);
    return !answered.some((a) => {
      if (p.kind === "place_visit" || a.kind === "place_visit") return a.fingerprint === p.id;
      const sameFamily =
        (p.kind === "new_trip" && a.kind === "new_trip") ||
        (p.kind !== "new_trip" && a.kind !== "new_trip" && a.targetId === (p.trip?.id ?? null));
      return sameFamily && !isMaterialChange(a.memberKeys, keys);
    });
  });
}
