/**
 * People on other servers the caller is paired with (spec 2026-10-20 §8: "Einstellungen → Reisen
 * teilen lists remote persons with their server"). One row per pairing, with the consent of the
 * pair as this server holds it.
 */
import { prisma } from "../../../db";
import { consentStatusSchema, type ConsentStatus } from "../../../schemas/sharing";
import { requireTripFederation } from "./access";

export interface RemotePersonView {
  id: string;
  origin: string;
  username: string;
  displayName: string;
  consent: ConsentStatus;
  createdAt: string;
}

const PAIR_INCLUDE = (userId: string) => ({
  consentsRequested: { where: { targetId: userId }, select: { status: true } },
  consentsTargeted: { where: { requesterId: userId }, select: { status: true } },
});

type PairRow = {
  id: string;
  origin: string;
  username: string;
  displayName: string;
  createdAt: Date;
  consentsRequested: { status: string }[];
  consentsTargeted: { status: string }[];
};

export function remotePersonView(row: PairRow): RemotePersonView {
  const consent = [...row.consentsRequested, ...row.consentsTargeted][0];
  return {
    id: row.id,
    origin: row.origin,
    username: row.username,
    displayName: row.displayName,
    // A pairing always carries its consent (both are written in one transaction); a row
    // without one reads as withdrawn rather than as a yes nobody gave.
    consent: consent ? consentStatusSchema.parse(consent.status) : "withdrawn",
    createdAt: row.createdAt.toISOString(),
  };
}

export async function readRemotePerson(userId: string, id: string): Promise<RemotePersonView> {
  const row = await prisma.remoteShareAccount.findFirstOrThrow({
    where: { id, userId },
    include: PAIR_INCLUDE(userId),
  });
  return remotePersonView(row);
}

export async function listRemotePeople(userId: string): Promise<RemotePersonView[]> {
  await requireTripFederation(userId);
  const rows = await prisma.remoteShareAccount.findMany({
    where: { userId },
    include: PAIR_INCLUDE(userId),
    orderBy: { createdAt: "desc" },
  });
  return rows.map(remotePersonView);
}
