/**
 * "X may see my numbers" (spec §5, §9.1). Uses the sharing people model (`SharePerson`,
 * `PERSON_SELECT`, `toPerson`) and its state machine (pending → accepted | declined;
 * withdrawn ends; a declined pair may be asked again), but NOT the `ShareConsent` row: that row
 * means "may push trips into my account" and its withdrawal detaches trip copies. A comparison
 * must authorise neither.
 *
 * One row is one direction: the owner's totals, one viewer. Every reader asks for an ACCEPTED
 * row and nothing else.
 *
 * Asking does NOT share yet (controller ruling 2026-10-16, overriding spec G1). Had a request
 * written the asker's row as accepted at once, anyone could put themselves on anyone's
 * leaderboard by username, and stay there after a decline. So a pending row has two meanings,
 * told apart by `decidedAt`:
 *  - a QUESTION to its owner (`decidedAt` null): the owner has not answered; it is listed under
 *    their requests and only they can accept or decline it. A restored backup leaves every
 *    consent in this state (`federation/restore.ts`), so each side confirms again on its own;
 *  - an OFFER by its owner (`decidedAt` set, scope chosen): the asker's own yes, held back until
 *    the other side answers. Acceptance turns it accepted, a decline withdraws it.
 */
import { prisma, type DbTransaction } from "../../db";
import { Prisma } from "../../prisma";
import logger from "../../utils/logger";
import { PERSON_SELECT, toPerson } from "../sharing/people";
import {
  leaderboardScopeSchema,
  type ConsentStatus,
  type LeaderboardScope,
  type Person,
  type PersonView,
  type RequestView,
} from "../../schemas/comparison";
import { comparisonError } from "./errors";

export const localKey = (userId: string): string => `local:${userId}`;
export const remoteKey = (remoteId: string): string => `remote:${remoteId}`;
export const scopeJson = (scope: LeaderboardScope): Prisma.InputJsonValue =>
  scope as unknown as Prisma.InputJsonValue;

/**
 * A stored scope as a reader may use it. One malformed row (an old grant copied in, a hand
 * edit) must cost that one row its numbers — "not shared" — and a log line, never the page.
 */
export function readScope(raw: unknown, consentId: string): LeaderboardScope | null {
  if (raw === null || raw === undefined) return null;
  const parsed = leaderboardScopeSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  logger.warn(
    { operation: "comparison_scope_invalid", consentId, issues: parsed.error.issues.length },
    "Stored leaderboard scope does not parse; treated as not shared"
  );
  return null;
}

export function localPerson(user: Parameters<typeof toPerson>[0]): Person {
  const p = toPerson(user);
  return {
    key: localKey(p.id),
    kind: "local",
    username: p.username,
    displayName: p.displayName,
    origin: null,
  };
}

export function remotePerson(remote: {
  id: string;
  username: string;
  displayName: string;
  origin: string;
}): Person {
  return {
    key: remoteKey(remote.id),
    kind: "remote",
    username: remote.username,
    displayName: remote.displayName,
    origin: remote.origin,
  };
}

type ConsentState = { status: string; decidedAt: Date | null };
const isQuestion = (c: ConsentState | null | undefined) =>
  c?.status === "pending" && c.decidedAt === null;
const isOffer = (c: ConsentState | null | undefined) =>
  c?.status === "pending" && c.decidedAt !== null;

const notFound = (userId: string, consentId?: string) =>
  comparisonError("COMPARISON_NOT_FOUND", 404, "No such comparison", { userId, consentId });
const notPending = (userId: string, consentId: string) =>
  comparisonError("COMPARISON_NOT_PENDING", 409, "Not waiting for an answer", {
    userId,
    consentId,
  });

type Tx = DbTransaction;

/**
 * Serialises every write on one local pair. Two people asking each other at the same moment
 * would otherwise both read "nothing yet", both create, and one would die on the unique index.
 * The rows may not exist yet, so a row lock cannot do this; an advisory lock on the pair can.
 */
async function lockPair(tx: Tx, a: string, b: string): Promise<void> {
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${key}::text, 0))) l`;
}

/**
 * A write that holds only if the row is still in the state it was read in. A count of 0 means
 * the other side moved first (ended, answered); the transaction rolls back as a whole.
 */
async function guarded(
  tx: Tx,
  where: Prisma.LeaderboardConsentWhereInput & { id: string },
  data: Prisma.LeaderboardConsentUpdateManyMutationInput,
  userId: string
): Promise<void> {
  const changed = await tx.leaderboardConsent.updateMany({ where, data });
  if (changed.count === 0) throw notPending(userId, where.id);
}

export async function requestComparison(
  requesterId: string,
  username: string,
  scope: LeaderboardScope
): Promise<PersonView> {
  const parsed = scopeJson(leaderboardScopeSchema.parse(scope));
  const target = await prisma.user.findFirst({
    where: { username: { equals: username.trim(), mode: "insensitive" }, isActive: true },
    select: PERSON_SELECT,
  });
  if (!target)
    throw comparisonError("COMPARISON_USER_NOT_FOUND", 404, "No such user on this server", {
      userId: requesterId,
    });
  if (target.id === requesterId)
    throw comparisonError("COMPARISON_SELF", 400, "Cannot compare with yourself", {
      userId: requesterId,
    });
  await prisma.$transaction(async (tx) => {
    await lockPair(tx, requesterId, target.id);
    const [mine, theirs] = await Promise.all([
      tx.leaderboardConsent.findUnique({
        where: { ownerId_viewerId: { ownerId: requesterId, viewerId: target.id } },
      }),
      tx.leaderboardConsent.findUnique({
        where: { ownerId_viewerId: { ownerId: target.id, viewerId: requesterId } },
      }),
    ]);
    // The other side has already said yes — they asked first, or they share already. Asking
    // back is then the answer, and both directions take effect together.
    const answered = isOffer(theirs) || theirs?.status === "accepted";
    const iShare = mine?.status === "accepted";
    // A one-way share (a copied grant) still lets the asker put the question the other way.
    if (isOffer(mine) || (iShare && (answered || isQuestion(theirs))))
      throw comparisonError("COMPARISON_DUPLICATE", 409, "Already asked or sharing", {
        userId: requesterId,
      });
    const now = new Date();
    const status = answered ? "accepted" : "pending";
    if (!mine)
      await tx.leaderboardConsent.create({
        data: { ownerId: requesterId, viewerId: target.id, status, scope: parsed, decidedAt: now },
      });
    else if (!iShare)
      await guarded(
        tx,
        { id: mine.id, status: mine.status, decidedAt: mine.decidedAt },
        { status, scope: parsed, decidedAt: now, ...(answered ? {} : { createdAt: now }) },
        requesterId
      );
    if (answered) {
      if (theirs && isOffer(theirs))
        await guarded(
          tx,
          { id: theirs.id, status: "pending", decidedAt: { not: null } },
          { status: "accepted", decidedAt: now },
          requesterId
        );
      return;
    }
    if (!theirs)
      await tx.leaderboardConsent.create({ data: { ownerId: target.id, viewerId: requesterId } });
    else if (!isQuestion(theirs))
      // The answer belongs to the asked side; a new question deserves a new answer.
      await guarded(
        tx,
        { id: theirs.id, status: theirs.status, decidedAt: theirs.decidedAt },
        { status: "pending", scope: Prisma.DbNull, createdAt: now, decidedAt: null },
        requesterId
      );
  });
  return personView(requesterId, localKey(target.id));
}

async function ownedConsent(ownerId: string, consentId: string) {
  const row = await prisma.leaderboardConsent.findFirst({ where: { id: consentId, ownerId } });
  if (!row) throw notFound(ownerId, consentId);
  return row;
}
const keyOf = (row: { viewerId: string | null; remoteId: string | null }) =>
  row.viewerId ? localKey(row.viewerId) : remoteKey(row.remoteId as string);
/** The asker's held-back offer that answers to this question, if the question is local. */
const offerWhere = (row: { ownerId: string; viewerId: string | null }) =>
  row.viewerId
    ? {
        ownerId: row.viewerId,
        viewerId: row.ownerId,
        status: "pending",
        decidedAt: { not: null },
      }
    : null;

export async function acceptConsent(
  ownerId: string,
  consentId: string,
  scope: LeaderboardScope
): Promise<PersonView> {
  const row = await ownedConsent(ownerId, consentId);
  if (!isQuestion(row)) throw notPending(ownerId, consentId);
  const parsed = scopeJson(leaderboardScopeSchema.parse(scope));
  await prisma.$transaction(async (tx) => {
    if (row.viewerId) await lockPair(tx, ownerId, row.viewerId);
    const now = new Date();
    // Conditional on still being a question: two answers racing must not both win.
    const answered = await tx.leaderboardConsent.updateMany({
      where: { id: row.id, status: "pending", decidedAt: null },
      data: { status: "accepted", scope: parsed, decidedAt: now },
    });
    if (answered.count === 0) throw notPending(ownerId, consentId);
    const offer = offerWhere(row);
    if (offer)
      await tx.leaderboardConsent.updateMany({
        where: offer,
        data: { status: "accepted", decidedAt: now },
      });
  });
  return personView(ownerId, keyOf(row));
}

export async function declineConsent(
  ownerId: string,
  consentId: string
): Promise<{ declined: true }> {
  const row = await ownedConsent(ownerId, consentId);
  if (!isQuestion(row)) throw notPending(ownerId, consentId);
  await prisma.$transaction(async (tx) => {
    if (row.viewerId) await lockPair(tx, ownerId, row.viewerId);
    const now = new Date();
    const answered = await tx.leaderboardConsent.updateMany({
      where: { id: row.id, status: "pending", decidedAt: null },
      data: { status: "declined", decidedAt: now },
    });
    if (answered.count === 0) throw notPending(ownerId, consentId);
    // The asker's offer was conditional on a yes; after a no, nothing stays visible either way.
    const offer = offerWhere(row);
    if (offer)
      await tx.leaderboardConsent.updateMany({
        where: offer,
        data: { status: "withdrawn", decidedAt: now },
      });
  });
  return { declined: true };
}

export async function updateScope(
  ownerId: string,
  consentId: string,
  scope: LeaderboardScope
): Promise<PersonView> {
  const row = await ownedConsent(ownerId, consentId);
  if (row.status !== "accepted") throw notFound(ownerId, consentId);
  await prisma.leaderboardConsent.update({
    where: { id: row.id },
    data: { scope: scopeJson(leaderboardScopeSchema.parse(scope)), decidedAt: new Date() },
  });
  return personView(ownerId, keyOf(row));
}

/** Either side ends a local comparison — or takes back a question; both directions stop. */
export async function endLocal(userId: string, otherUserId: string): Promise<void> {
  const ended = await prisma.$transaction(async (tx) => {
    await lockPair(tx, userId, otherUserId);
    return tx.leaderboardConsent.updateMany({
      where: {
        status: { not: "withdrawn" },
        OR: [
          { ownerId: userId, viewerId: otherUserId },
          { ownerId: otherUserId, viewerId: userId },
        ],
      },
      data: { status: "withdrawn", decidedAt: new Date() },
    });
  });
  if (ended.count === 0) throw notFound(userId);
}

export async function listPeople(
  userId: string
): Promise<{ requests: RequestView[]; people: PersonView[] }> {
  const [owned, viewed, remotes] = await Promise.all([
    prisma.leaderboardConsent.findMany({
      where: { ownerId: userId },
      include: { viewer: { select: PERSON_SELECT }, remote: true },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    prisma.leaderboardConsent.findMany({
      where: { viewerId: userId, owner: { isActive: true } },
      include: { owner: { select: PERSON_SELECT } },
      take: 200,
    }),
    prisma.leaderboardRemote.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
  ]);
  const personOf = (c: (typeof owned)[number]) =>
    c.viewer ? localPerson(c.viewer) : remotePerson(c.remote as NonNullable<typeof c.remote>);
  const requests = owned
    .filter(isQuestion)
    .map((c) => ({ consentId: c.id, person: personOf(c), createdAt: c.createdAt.toISOString() }));
  const people = new Map<string, PersonView>();
  const entry = (person: Person): PersonView =>
    people.get(person.key) ?? { person, mine: null, theirs: null };
  for (const c of owned) {
    if (isQuestion(c)) continue; // listed as a request, not yet as a person
    const person = personOf(c);
    people.set(person.key, {
      ...entry(person),
      mine: { consentId: c.id, status: c.status as ConsentStatus, scope: readScope(c.scope, c.id) },
    });
  }
  for (const c of viewed) {
    const person = localPerson(c.owner);
    people.set(person.key, { ...entry(person), theirs: { status: c.status as ConsentStatus } });
  }
  for (const r of remotes) {
    const person = remotePerson(r);
    if (!people.has(person.key)) people.set(person.key, entry(person));
  }
  // A person is listed once there is a yes on either side or the caller's own open question.
  // Someone who merely asked the caller is a request, not yet a person (controller ruling).
  const live = [...people.values()].filter(
    (p) =>
      p.person.kind === "remote" ||
      p.mine?.status === "accepted" ||
      p.mine?.status === "pending" ||
      p.theirs?.status === "accepted"
  );
  return { requests, people: live };
}

export async function personView(userId: string, key: string): Promise<PersonView> {
  const found = (await listPeople(userId)).people.find((p) => p.person.key === key);
  if (!found) throw notFound(userId);
  return found;
}
