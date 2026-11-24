import { prisma } from "../../db";
import { parseTripEvidence } from "../locationEvidence/trips/evidence";
import { resolveHome } from "./context";
import { invalidateTripSuggestions } from "./engine";
import { homeSignature } from "./rejectionMemory";
import { dayColumn } from "./time";

/**
 * One decision table (trip suggestions v2): an answered TravTrack trip question
 * is written to `trip_suggestion_decisions` beside the engine's answers, with
 * its days, so a period rejected there also silences the engine over the same
 * days — and the merged stream reads one memory. The migration
 * `20261123211841_trip_suggestions_v2` copied the answers given before.
 *
 * Fingerprint `travtrack:<evidence key>`, the migration's: one row per question.
 */
export async function recordTravTrackTripDecision(
  userId: string,
  suggestionId: string,
  status: "accepted" | "dismissed"
): Promise<void> {
  const row = await prisma.locationSuggestion.findFirst({
    where: { id: suggestionId, userId, kind: "trip" },
    select: { evidenceKey: true, evidence: true },
  });
  const evidence = row ? parseTripEvidence(row.evidence) : null;
  if (!row || !evidence) return;
  const fingerprint = `travtrack:${row.evidenceKey}`;
  // The residence the period was judged against, as the engine stores it: a
  // rejection made before a move does not silence the same days after it.
  const { homeAt } = await resolveHome(userId);
  const data = {
    kind: evidence.tripId ? "extend" : "new_trip",
    status,
    targetId: evidence.tripId,
    memberKeys: [],
    memberContentKeys: [],
    startDay: dayColumn(evidence.fromDay),
    endDay: dayColumn(evidence.toDay),
    homeSignature: homeSignature(homeAt(evidence.fromDay)),
    source: "travtrack",
    expanded: evidence.expanded === true,
  };
  await prisma.tripSuggestionDecision.upsert({
    where: { userId_fingerprint: { userId, fingerprint } },
    create: { userId, fingerprint, ...data },
    update: data,
  });
  invalidateTripSuggestions(userId);
}

/**
 * "Abgelehnte zurücksetzen": forget every dismissal of this account — the
 * engine's and TravTrack's — so each period may be asked again. A rejected
 * TravTrack row is deleted with its decision: the sweep never re-asks a period
 * it has a row for. Accepted answers stay; they made trips.
 */
export async function resetTripSuggestionRejections(userId: string): Promise<number> {
  const [decisions] = await prisma.$transaction([
    prisma.tripSuggestionDecision.deleteMany({ where: { userId, status: "dismissed" } }),
    prisma.locationSuggestion.deleteMany({ where: { userId, kind: "trip", status: "rejected" } }),
  ]);
  invalidateTripSuggestions(userId);
  return decisions.count;
}
