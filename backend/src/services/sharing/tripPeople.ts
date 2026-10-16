import { prisma } from "../../db";
import { consentStatusSchema, type ConsentStatus } from "../../schemas/sharing";
import { acceptedWith, missingGroupConsent } from "./members";
import { PERSON_SELECT, toPerson, type SharePerson } from "./people";

/**
 * The people of one trip as its page shows them (spec 2026-10-16, D9): each
 * companion on the trip, then each member of the trip's share group who is not
 * one of them — with whether they are linked to an account, what the caller's
 * consent request to that account says, whether they hold the trip, whether
 * changes reach them, and the ONE reason sharing with them is not possible yet.
 *
 * The reason is decided here, before a click, so the page never draws an
 * action the server would refuse (`shareTrip` checks the same rules).
 */
export type ShareBlock =
  | "notLinked"
  | "consentMissing"
  | "consentPending"
  | "groupConsentMissing"
  | "alreadyMember"
  | "accountInactive";

export interface TripPerson {
  /** "c:<companionId>" for a companion, "u:<userId>" for a member who is none. */
  key: string;
  companionId: string | null;
  name: string;
  account: SharePerson | null;
  /** The caller's request to `account`; "none" when there is no row. */
  consent: "none" | ConsentStatus;
  member: boolean;
  /** Members only: an accepted consent in either direction lets changes through. */
  receivesChanges: boolean | null;
  shareBlockedBy: ShareBlock | null;
}

export async function tripPeople(
  userId: string,
  trip: { id: string; shareGroupId: string | null }
): Promise<{ people: TripPerson[]; linkableUsers: SharePerson[] }> {
  const [links, memberTrips, outgoing] = await Promise.all([
    prisma.tripCompanion.findMany({
      where: { tripId: trip.id },
      orderBy: { position: "asc" },
      include: { companion: { include: { linkedUser: { select: PERSON_SELECT } } } },
    }),
    trip.shareGroupId
      ? prisma.trip.findMany({
          where: { shareGroupId: trip.shareGroupId, NOT: { userId } },
          select: { user: { select: PERSON_SELECT } },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
    prisma.shareConsent.findMany({
      where: { requesterId: userId },
      include: { target: { select: { ...PERSON_SELECT, isActive: true } } },
      orderBy: { decidedAt: "desc" },
    }),
  ]);
  const members = memberTrips.map((t) => toPerson(t.user));
  const memberIds = members.map((m) => m.id);
  const consentOf = new Map(outgoing.map((c) => [c.targetId, consentStatusSchema.parse(c.status)]));
  const accountIds = [
    ...memberIds,
    ...links.flatMap((l) => (l.companion.linkedUser ? [l.companion.linkedUser.id] : [])),
  ];
  const inactive = new Set(
    (
      await prisma.user.findMany({
        where: { id: { in: accountIds }, isActive: false },
        select: { id: true },
      })
    ).map((u) => u.id)
  );
  const receiving = await acceptedWith(prisma, userId, memberIds);

  // The onward-share rule has one home (`missingGroupConsent`), shared with `shareTrip`.
  const groupAgrees = async (accountId: string): Promise<boolean> =>
    !trip.shareGroupId ||
    (await missingGroupConsent(prisma, trip.shareGroupId, userId, accountId)).length === 0;

  const rowFor = async (
    key: string,
    companionId: string | null,
    name: string,
    account: SharePerson | null
  ): Promise<TripPerson> => {
    const member = account !== null && memberIds.includes(account.id);
    const consent = account ? (consentOf.get(account.id) ?? "none") : "none";
    let shareBlockedBy: ShareBlock | null = null;
    if (!account) shareBlockedBy = "notLinked";
    else if (inactive.has(account.id)) shareBlockedBy = "accountInactive";
    else if (member) shareBlockedBy = "alreadyMember";
    else if (consent === "pending") shareBlockedBy = "consentPending";
    else if (consent !== "accepted") shareBlockedBy = "consentMissing";
    else if (!(await groupAgrees(account.id))) shareBlockedBy = "groupConsentMissing";
    return {
      key,
      companionId,
      name,
      account,
      consent,
      member,
      receivesChanges: member && account ? receiving.has(account.id) : null,
      shareBlockedBy,
    };
  };

  const people: TripPerson[] = [];
  for (const link of links) {
    const c = link.companion;
    people.push(
      await rowFor(`c:${c.id}`, c.id, c.displayName, c.linkedUser ? toPerson(c.linkedUser) : null)
    );
  }
  const shown = new Set(people.flatMap((p) => (p.account ? [p.account.id] : [])));
  for (const member of members) {
    if (!shown.has(member.id)) {
      people.push(await rowFor(`u:${member.id}`, null, member.displayName, member));
    }
  }
  return {
    people,
    linkableUsers: outgoing
      .filter((c) => c.status === "accepted" && c.target.isActive)
      .map((c) => toPerson(c.target)),
  };
}
