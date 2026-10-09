import { prisma } from "../../db";
import type { DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { detachAfterWithdrawal } from "./detach";
import { PERSON_SELECT, toPerson, type SharePerson } from "./people";

/**
 * Consent first (design 2026-10-09, decision 4): no trip is pushed into an
 * account that has not said yes to the pusher. A `ShareConsent` row is one
 * ordered pair — `requesterId` may share INTO `targetId` once the target has
 * accepted. Either side may withdraw; copies already made stay where they are.
 */

export type ConsentStatus = "pending" | "accepted" | "declined" | "withdrawn";

export interface ConsentView {
  id: string;
  status: ConsentStatus;
  createdAt: string;
  decidedAt: string | null;
  /** The OTHER side of the pair, from the caller's point of view. */
  person: SharePerson;
}

const notFound = () => new AppError("Consent not found", 404, "SHARE_CONSENT_NOT_FOUND");

function view(
  row: {
    id: string;
    status: string;
    createdAt: Date;
    decidedAt: Date | null;
  },
  person: Parameters<typeof toPerson>[0]
): ConsentView {
  return {
    id: row.id,
    status: row.status as ConsentStatus,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    person: toPerson(person),
  };
}

/**
 * Ask `username` for consent. Only accounts on this server, never oneself;
 * a pair that is already pending or accepted is refused rather than asked
 * twice. A declined or withdrawn pair is asked again — the answer belongs to
 * the target, and a new question deserves a new answer.
 */
export async function requestConsent(requesterId: string, username: string): Promise<ConsentView> {
  const target = await prisma.user.findFirst({
    where: { username: { equals: username.trim(), mode: "insensitive" }, isActive: true },
    select: PERSON_SELECT,
  });
  if (!target) throw new AppError("No such user on this server", 404, "SHARE_USER_NOT_FOUND");
  if (target.id === requesterId) {
    throw new AppError("Cannot ask yourself for consent", 400, "SHARE_SELF");
  }

  const existing = await prisma.shareConsent.findUnique({
    where: { requesterId_targetId: { requesterId, targetId: target.id } },
  });
  if (existing && (existing.status === "pending" || existing.status === "accepted")) {
    throw new AppError("Consent already requested", 409, "SHARE_CONSENT_DUPLICATE", undefined, {
      status: existing.status,
    });
  }
  const row = existing
    ? await prisma.shareConsent.update({
        where: { id: existing.id },
        data: { status: "pending", createdAt: new Date(), decidedAt: null },
      })
    : await prisma.shareConsent.create({ data: { requesterId, targetId: target.id } });
  return view(row, target);
}

/** Both directions of the caller's consents, newest first. */
export async function listConsents(
  userId: string
): Promise<{ incoming: ConsentView[]; outgoing: ConsentView[] }> {
  const [incoming, outgoing] = await Promise.all([
    prisma.shareConsent.findMany({
      where: { targetId: userId },
      include: { requester: { select: PERSON_SELECT } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.shareConsent.findMany({
      where: { requesterId: userId },
      include: { target: { select: PERSON_SELECT } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return {
    incoming: incoming.map((row) => view(row, row.requester)),
    outgoing: outgoing.map((row) => view(row, row.target)),
  };
}

/** Accept or decline — the target's answer, once, while pending. */
export async function decideConsent(
  userId: string,
  consentId: string,
  decision: "accepted" | "declined"
): Promise<ConsentView> {
  const row = await prisma.shareConsent.findFirst({
    where: { id: consentId, targetId: userId },
    include: { requester: { select: PERSON_SELECT } },
  });
  if (!row) throw notFound();
  if (row.status !== "pending") {
    throw new AppError("Consent is not pending", 409, "SHARE_CONSENT_NOT_PENDING", undefined, {
      status: row.status,
    });
  }
  const updated = await prisma.shareConsent.update({
    where: { id: row.id },
    data: { status: decision, decidedAt: new Date() },
  });
  return view(updated, row.requester);
}

/**
 * Either side ends the pair. Nothing already copied is deleted (decision 4):
 * the copies are the recipient's trips. What stops is any further share AND
 * any further change: the target's copies of trips shared with the requester
 * leave their groups and stay as independent trips (spec, "S2 as built").
 */
export async function withdrawConsent(userId: string, consentId: string): Promise<ConsentView> {
  const row = await prisma.shareConsent.findFirst({
    where: { id: consentId, OR: [{ requesterId: userId }, { targetId: userId }] },
    include: { requester: { select: PERSON_SELECT }, target: { select: PERSON_SELECT } },
  });
  if (!row) throw notFound();
  const updated =
    row.status === "withdrawn"
      ? row
      : await prisma.$transaction(async (tx) => {
          const done = await tx.shareConsent.update({
            where: { id: row.id },
            data: { status: "withdrawn", decidedAt: new Date() },
          });
          // S2: the target stops receiving the requester's changes — their
          // copies become independent trips (`detach.ts`).
          await detachAfterWithdrawal(tx, row.requesterId, row.targetId);
          return done;
        });
  return view(updated, row.requesterId === userId ? row.target : row.requester);
}

/** Has `targetId` accepted that `requesterId` shares into their account? */
export async function hasAcceptedConsent(
  client: Pick<DbTransaction, "shareConsent">,
  requesterId: string,
  targetId: string
): Promise<boolean> {
  const row = await client.shareConsent.findUnique({
    where: { requesterId_targetId: { requesterId, targetId } },
    select: { status: true },
  });
  return row?.status === "accepted";
}

export function consentRequired(): AppError {
  return new AppError(
    "The other account has not accepted sharing with you",
    403,
    "SHARE_CONSENT_REQUIRED"
  );
}
