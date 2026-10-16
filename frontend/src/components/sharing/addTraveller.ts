import { sharingApi } from "../../lib/api/sharing";
import { tripsApi } from "../../lib/api/trips";
import type { SharePerson, TripPerson, TripSharing } from "../../types/sharing";

/**
 * "ilse " and "Ilse" are one person. The same fold as the server's companion
 * identity (`canonicalizeCompanionName`, backend `utils/companionName.ts`), so
 * the page never splits a person the server holds as one.
 */
export const nameKey = (name: string): string =>
  name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Which step failed: the name already belongs to a companion linked to a
 * different account (nothing changed — a retry would only fail the same way),
 * nothing changed, added but not linked, or done but not reloaded.
 */
export type AddTravellerStage = "nameTaken" | "add" | "link" | "reload";

export class AddTravellerError extends Error {
  constructor(
    readonly stage: AddTravellerStage,
    /** What the failing call threw — logged, never shown. */
    readonly reason: unknown,
    /** The trip's people as they are after the failure, when known. */
    readonly people?: TripPerson[]
  ) {
    super(`Adding a traveller failed at ${stage}`);
    this.name = "AddTravellerError";
  }
}

/**
 * Make an account that agreed to sharing a traveller of the trip, linked to
 * that account, through the two existing write paths: the trip's companion
 * list (the account's display name; the server's companion identity reuses an
 * existing companion of that name) and the companion link. Shares nothing —
 * the caller asks for the share afterwards.
 *
 * Each failure names its step, so the dialog never hides a half state: after
 * a failed link the new traveller exists, unlinked, and is shown as such.
 */
export async function addAndLinkTraveller(
  tripId: string,
  user: SharePerson
): Promise<{ view: TripSharing; key: string }> {
  const wanted = nameKey(user.displayName);
  // A companion is identified by its name: one of that name linked to another
  // account would be put on the trip and could never be linked to this one.
  let taken: boolean;
  try {
    const { companions } = await sharingApi.listCompanions();
    taken = companions.some(
      (c) => nameKey(c.name) === wanted && c.linkedUser !== null && c.linkedUser.id !== user.id
    );
  } catch (err) {
    throw new AddTravellerError("add", err);
  }
  if (taken) throw new AddTravellerError("nameTaken", null);
  try {
    const names = (await tripsApi.getById(tripId)).companions ?? [];
    if (!names.some((n) => nameKey(n) === wanted)) {
      await tripsApi.update(tripId, { companions: [...names, user.displayName] });
    }
  } catch (err) {
    throw new AddTravellerError("add", err);
  }

  let people: TripPerson[] | undefined;
  let companionId: string;
  try {
    people = (await sharingApi.tripSharing(tripId)).people;
    const row = people.find(
      (p) =>
        p.companionId !== null &&
        nameKey(p.name) === wanted &&
        (p.account === null || p.account.id === user.id)
    );
    if (!row?.companionId) throw new Error("The added traveller is not on the trip");
    companionId = row.companionId;
    if (!row.account) await sharingApi.linkCompanion(companionId, user.id);
  } catch (err) {
    throw new AddTravellerError("link", err, people);
  }

  try {
    return { view: await sharingApi.tripSharing(tripId), key: `c:${companionId}` };
  } catch (err) {
    throw new AddTravellerError("reload", err);
  }
}
