import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { consentRequired, hasAcceptedConsent } from "./consent";
import { PERSON_SELECT, toPerson, type SharePerson } from "./people";

/**
 * A companion that IS an account on this server (decision 4). The link needs
 * an accepted consent that account gave the caller — a name typed into a
 * form must never be enough to reach into someone else's logbook.
 */

export interface LinkableCompanion {
  id: string;
  name: string;
  linkedUser: SharePerson | null;
}

const companionNotFound = () => new AppError("Companion not found", 404, "COMPANION_NOT_FOUND");

/** The caller's companions with their link, and the accounts they may link to. */
export async function listLinkableCompanions(userId: string): Promise<{
  companions: LinkableCompanion[];
  linkableUsers: SharePerson[];
}> {
  const [companions, consents] = await Promise.all([
    prisma.companion.findMany({
      where: { userId },
      include: { linkedUser: { select: PERSON_SELECT } },
      orderBy: { displayName: "asc" },
    }),
    prisma.shareConsent.findMany({
      where: { requesterId: userId, status: "accepted" },
      include: { target: { select: PERSON_SELECT } },
      orderBy: { decidedAt: "desc" },
    }),
  ]);
  return {
    companions: companions.map((c) => ({
      id: c.id,
      name: c.displayName,
      linkedUser: c.linkedUser ? toPerson(c.linkedUser) : null,
    })),
    linkableUsers: consents.map((c) => toPerson(c.target)),
  };
}

export async function linkCompanion(
  userId: string,
  companionId: string,
  targetUserId: string
): Promise<LinkableCompanion> {
  const companion = await prisma.companion.findFirst({ where: { id: companionId, userId } });
  if (!companion) throw companionNotFound();
  if (targetUserId === userId) {
    throw new AppError("A companion cannot be your own account", 400, "SHARE_SELF");
  }
  // Checked before the target is looked up, so an id that is no account and
  // an account that never said yes answer alike: no probing for ids.
  if (!(await hasAcceptedConsent(prisma, userId, targetUserId))) throw consentRequired();

  const other = await prisma.companion.findFirst({
    where: { userId, linkedUserId: targetUserId, NOT: { id: companionId } },
    select: { id: true, displayName: true },
  });
  if (other) {
    throw new AppError(
      "Another companion is already linked to that account",
      409,
      "SHARE_COMPANION_ALREADY_LINKED",
      undefined,
      { companionId: other.id, companionName: other.displayName }
    );
  }
  const updated = await prisma.companion.update({
    where: { id: companion.id },
    data: { linkedUserId: targetUserId },
    include: { linkedUser: { select: PERSON_SELECT } },
  });
  return {
    id: updated.id,
    name: updated.displayName,
    linkedUser: updated.linkedUser ? toPerson(updated.linkedUser) : null,
  };
}

export async function unlinkCompanion(
  userId: string,
  companionId: string
): Promise<LinkableCompanion> {
  const companion = await prisma.companion.findFirst({ where: { id: companionId, userId } });
  if (!companion) throw companionNotFound();
  const updated = await prisma.companion.update({
    where: { id: companion.id },
    data: { linkedUserId: null },
  });
  return { id: updated.id, name: updated.displayName, linkedUser: null };
}
