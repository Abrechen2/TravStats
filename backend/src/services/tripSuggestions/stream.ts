import { prisma } from "../../db";
import { parseTripEvidence } from "../locationEvidence/trips/evidence";
import { readSuggestionSwitches } from "../settings/suggestionSwitches";
import { loadTrips, readUserScope, resolveHome } from "./context";
import { computeTripSuggestions, loadAnswered, type EngineResult } from "./engine";
import { COVERED_SHARE, coveredShare, spanDecisions, tripSpans } from "./proposals";
import { clampQuietDays, homeSignature, judgeSpan, overlapDays } from "./rejectionMemory";
import { todayIn } from "./time";
import type { TripSuggestion } from "./types";

/**
 * One candidate stream (trip suggestions v2): the engine's proposals and the
 * TravTrack sweep's pending trip questions, merged before anything is shown.
 *
 * The two used to ask independently — a TravTrack period the engine had
 * already proposed (or the user had already rejected there) came back as a
 * second card, and neither honoured the other's answers. Here a TravTrack row
 * is shown only if the shared rejection memory lets it through, if existing
 * trips cover at most half its days, and if no engine proposal already covers
 * any of its days (the engine's has entries to link; it wins). Of what
 * survives, at most `MAX_OPEN_CARDS` are open at a time, newest first: the
 * owner asked for an inbox that never nags.
 *
 * Off (`tripSuggestionsEnabled`), the stream is `null`: nothing is computed,
 * and the pending TravTrack rows stay stored but hidden.
 */

export const MAX_OPEN_CARDS = 3;

export interface TripCardStream {
  /** The engine's proposals among the open cards. */
  engine: TripSuggestion[];
  /** The TravTrack trip questions among the open cards. */
  travTrackIds: Set<string>;
  /** Candidates that survived the merge, before the cap. */
  total: number;
  home: EngineResult["home"];
  truncated: boolean;
}

interface TravTrackRow {
  id: string;
  fromDay: string;
  toDay: string;
  /** The sweep re-asked a rejected period that grew past double ("erweitert"). */
  expanded?: boolean;
}

async function pendingTravTrackTrips(userId: string): Promise<TravTrackRow[]> {
  const rows = await prisma.locationSuggestion.findMany({
    where: { userId, kind: "trip", status: { in: ["pending", "accepting"] } },
    select: { id: true, evidence: true },
  });
  return rows.flatMap((r) => {
    const e = parseTripEvidence(r.evidence);
    return e ? [{ id: r.id, fromDay: e.fromDay, toDay: e.toDay, expanded: e.expanded }] : [];
  });
}

/** The merge itself, pure: what of `travTrack` survives next to `engine`, and the cap. */
export function mergeStream(input: {
  engine: readonly TripSuggestion[];
  travTrack: readonly TravTrackRow[];
  tripSpans: Iterable<{ startDay: string; endDay: string }>;
  isRejected: (span: { startDay: string; endDay: string }, expanded: boolean) => boolean;
  cap?: number;
}): { engine: TripSuggestion[]; travTrackIds: Set<string>; total: number } {
  const spans = [...input.tripSpans];
  const tripCards = input.engine.filter((p) => p.kind !== "place_visit");
  const travTrack = input.travTrack.filter((row) => {
    const span = { startDay: row.fromDay, endDay: row.toDay };
    if (input.isRejected(span, row.expanded === true)) return false;
    if (coveredShare(span, spans) > COVERED_SHARE) return false;
    return !tripCards.some((p) => overlapDays(p, span) > 0);
  });
  const merged = [
    ...input.engine.map((p) => ({ day: p.startDay, engine: p, id: null as string | null })),
    ...travTrack.map((r) => ({ day: r.fromDay, engine: null, id: r.id })),
  ].sort((a, b) => b.day.localeCompare(a.day));
  const open = merged.slice(0, input.cap ?? MAX_OPEN_CARDS);
  return {
    engine: open.flatMap((c) => (c.engine ? [c.engine] : [])),
    travTrackIds: new Set(open.flatMap((c) => (c.id ? [c.id] : []))),
    total: merged.length,
  };
}

export async function openTripCards(userId: string): Promise<TripCardStream | null> {
  const switches = await readSuggestionSwitches(userId);
  if (!switches.tripSuggestionsEnabled) return null;
  const [result, rows, answered, trips, scope, home] = await Promise.all([
    computeTripSuggestions(userId),
    pendingTravTrackTrips(userId),
    loadAnswered(userId),
    loadTrips(userId),
    readUserScope(userId),
    resolveHome(userId),
  ]);
  const today = todayIn(scope.profileZone);
  const quietDays = clampQuietDays(switches.tripSuggestionQuietDays);
  const decisions = [...spanDecisions(answered, result.entries).values()];
  const merged = mergeStream({
    engine: result.suggestions,
    travTrack: rows,
    // Own dates widened by linked entries; a dateless trip whose entries reach
    // across years is no window and covers nothing.
    tripSpans: [...tripSpans(trips, result.entries).values()].filter((s) => s.window),
    // The sweep marks a question it re-asked as expanded; only such a question
    // may pass an "expanded" verdict, every other needs a clean one.
    isRejected: (span, expanded) => {
      const verdict = judgeSpan(
        {
          family: "trip",
          targetId: null,
          ...span,
          homeSignature: homeSignature(home.homeAt(span.startDay)),
        },
        decisions,
        today,
        quietDays
      );
      return verdict === "suppressed" || (verdict === "expanded" && !expanded);
    },
  });
  return { ...merged, home: result.home, truncated: result.truncated };
}
