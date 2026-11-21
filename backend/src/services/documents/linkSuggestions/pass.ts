import { prisma } from "../../../db";
import { Prisma } from "../../../prisma";
import logger from "../../../utils/logger";
import { startJob, type JobView, type ReportProgress } from "../../jobs/jobRegistry";
import { entryKey } from "../entryRefs";
import { evidenceOf, hasEvidence } from "./evidence";
import { loadTripEntries } from "./loadEntries";
import { entryContentKey, matchEntry, type EntryFacts, type MatchReason } from "./match";

/**
 * The pass that proposes "this document also covers …" (plan D4).
 *
 * First run: every stored document of the account that carries a parse
 * reading. Later runs: only documents created or given a link since the last
 * one. It never parses (the stored reading is the evidence), never writes a
 * link (a proposal waits in the inbox), and never asks twice: a row that
 * exists — pending, dismissed or accepted — is left alone, keyed by the
 * entry's content key so a deleted-and-reimported entry does not come back.
 */

export interface PassResult {
  documentsScanned: number;
  proposed: number;
}

interface Hit {
  facts: EntryFacts;
  reason: MatchReason;
}

/** The entries of `facts` a document covers that it is not linked to yet. */
export function candidatesFor(
  payload: unknown,
  tripIds: ReadonlySet<string>,
  linked: ReadonlySet<string>,
  entries: Iterable<EntryFacts>
): Hit[] {
  const evidence = evidenceOf(payload);
  if (!hasEvidence(evidence)) return [];
  const hits: Hit[] = [];
  for (const facts of entries) {
    if (!tripIds.has(facts.tripId) || linked.has(entryKey(facts))) continue;
    const reason = matchEntry(evidence, facts);
    if (reason) hits.push({ facts, reason });
  }
  return hits;
}

/** Documents the next pass has to look at, as a query fragment. */
function sinceFilter(since: Date | null): Prisma.DocumentWhereInput {
  return since
    ? { OR: [{ createdAt: { gt: since } }, { links: { some: { createdAt: { gt: since } } } }] }
    : {};
}

export async function needsPass(userId: string): Promise<boolean> {
  const pass = await prisma.documentLinkPass.findUnique({ where: { userId } });
  if (!pass) return true;
  const fresh = await prisma.document.count({
    where: { userId, parsedPayload: { not: Prisma.DbNull }, ...sinceFilter(pass.scannedUntil) },
  });
  return fresh > 0;
}

/** Drops pending proposals whose entry is gone or already linked. */
async function sweepStale(userId: string, entries: ReadonlyMap<string, EntryFacts>): Promise<void> {
  const pending = await prisma.documentLinkSuggestion.findMany({
    where: { userId, status: "pending" },
    select: { id: true, documentId: true, entryType: true, entryId: true },
  });
  if (pending.length === 0) return;
  const links = await prisma.documentLink.findMany({
    where: { documentId: { in: [...new Set(pending.map((p) => p.documentId))] } },
    select: {
      documentId: true,
      flightId: true,
      railJourneyId: true,
      busJourneyId: true,
      ferryJourneyId: true,
      lodgingStayId: true,
      rentalBookingId: true,
    },
  });
  const linked = new Set(
    links.flatMap((l) =>
      [
        ["flight", l.flightId],
        ["railJourney", l.railJourneyId],
        ["busJourney", l.busJourneyId],
        ["ferryJourney", l.ferryJourneyId],
        ["lodgingStay", l.lodgingStayId],
        ["rentalBooking", l.rentalBookingId],
      ].flatMap(([type, id]) => (id ? [`${l.documentId}|${type}:${id}`] : []))
    )
  );
  const stale = pending
    .filter(
      (p) =>
        !entries.has(`${p.entryType}:${p.entryId}`) ||
        linked.has(`${p.documentId}|${p.entryType}:${p.entryId}`)
    )
    .map((p) => p.id);
  if (stale.length > 0) {
    await prisma.documentLinkSuggestion.deleteMany({ where: { id: { in: stale } } });
  }
}

export async function runDocumentLinkPass(
  userId: string,
  report: ReportProgress = () => undefined
): Promise<PassResult> {
  const startedAt = new Date();
  const pass = await prisma.documentLinkPass.findUnique({ where: { userId } });
  const entries = await loadTripEntries(userId);
  await sweepStale(userId, entries);

  const documents = await prisma.document.findMany({
    where: {
      userId,
      parsedPayload: { not: Prisma.DbNull },
      ...sinceFilter(pass?.scannedUntil ?? null),
    },
    select: { id: true, parsedPayload: true },
    orderBy: { createdAt: "asc" },
  });
  const result: PassResult = { documentsScanned: 0, proposed: 0 };
  report(0, documents.length);

  for (const document of documents) {
    const links = await prisma.documentLink.findMany({
      where: { documentId: document.id },
      select: {
        tripId: true,
        flightId: true,
        railJourneyId: true,
        busJourneyId: true,
        ferryJourneyId: true,
        lodgingStayId: true,
        rentalBookingId: true,
      },
    });
    const linked = new Set<string>();
    const tripIds = new Set<string>();
    for (const l of links) {
      if (l.tripId) tripIds.add(l.tripId);
      const refs: [string, string | null][] = [
        ["flight", l.flightId],
        ["railJourney", l.railJourneyId],
        ["busJourney", l.busJourneyId],
        ["ferryJourney", l.ferryJourneyId],
        ["lodgingStay", l.lodgingStayId],
        ["rentalBooking", l.rentalBookingId],
      ];
      for (const [type, id] of refs) {
        if (!id) continue;
        linked.add(`${type}:${id}`);
        const facts = entries.get(`${type}:${id}`);
        if (facts) tripIds.add(facts.tripId);
      }
    }
    if (tripIds.size > 0) {
      for (const hit of candidatesFor(document.parsedPayload, tripIds, linked, entries.values())) {
        const contentKeyOfEntry = entryContentKey(hit.facts);
        const existing = await prisma.documentLinkSuggestion.findUnique({
          where: {
            documentId_contentKey: { documentId: document.id, contentKey: contentKeyOfEntry },
          },
        });
        if (existing) {
          // Pending and the entry was re-imported: follow it. A decided row stays decided.
          if (existing.status === "pending" && existing.entryId !== hit.facts.id) {
            await prisma.documentLinkSuggestion.update({
              where: { id: existing.id },
              data: { entryId: hit.facts.id, entryType: hit.facts.type, reason: hit.reason },
            });
          }
          continue;
        }
        await prisma.documentLinkSuggestion.create({
          data: {
            userId,
            documentId: document.id,
            entryType: hit.facts.type,
            entryId: hit.facts.id,
            contentKey: contentKeyOfEntry,
            reason: hit.reason,
          },
        });
        result.proposed += 1;
      }
    }
    result.documentsScanned += 1;
    report(result.documentsScanned, documents.length);
  }

  await prisma.documentLinkPass.upsert({
    where: { userId },
    create: { userId, scannedUntil: startedAt },
    update: { scannedUntil: startedAt },
  });
  logger.info({ operation: "document_link_pass", ...result }, "Document link pass finished");
  return result;
}

const running = new Map<string, JobView>();

/**
 * Starts the pass as a job unless one is already running for the account.
 * Returns the running job's view (so a second caller polls the same job), or
 * null when there is nothing to scan.
 */
export async function ensureDocumentLinkPass(userId: string): Promise<JobView | null> {
  const current = running.get(userId);
  if (current) return current;
  if (!(await needsPass(userId))) return null;
  const job = startJob("documentLinks.pass", userId, async (report) => {
    try {
      return await runDocumentLinkPass(userId, report);
    } finally {
      running.delete(userId);
    }
  });
  running.set(userId, job);
  return job;
}
