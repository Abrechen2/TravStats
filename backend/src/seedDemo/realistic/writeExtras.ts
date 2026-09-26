import { prisma } from "../../db";
import {
  HOME_PLACES,
  MEMBERSHIPS,
  OWN_LISTS,
  SUBSCRIBED_CHECKLISTS,
  WISHLIST,
} from "./data/extras";
import type { SeedContext } from "./context";
import { ensurePlace } from "./writeGround";
import { anchorDay } from "./time";
import {
  computeTripSuggestions,
  invalidateTripSuggestions,
} from "../../services/tripSuggestions/engine";
import { dismissSuggestion } from "../../services/tripSuggestions/accept";
import type { TripSuggestion } from "../../services/tripSuggestions/types";

/**
 * The traveller's cards, lists and home places. The cards are written first,
 * so the stays that were credited to them can point at them; the lists last,
 * once every place they gather exists.
 */

export async function writeMemberships(ctx: SeedContext): Promise<number> {
  for (const spec of MEMBERSHIPS) {
    const card = await prisma.loyaltyMembership.create({
      data: {
        userId: ctx.userId,
        domain: spec.domain,
        programName: spec.programName,
        membershipNumber: spec.membershipNumber,
        tier: spec.tier,
        airlineCodes: spec.airlineCodes ?? [],
      },
    });
    const chainIds = (spec.chains ?? []).flatMap((name) => {
      const id = ctx.chainIdByName.get(name);
      return id === undefined ? [] : [id];
    });
    if (chainIds.length > 0) {
      await prisma.lodgingMembershipChain.createMany({
        data: chainIds.map((chainId) => ({ membershipId: card.id, chainId })),
      });
    }
    ctx.membershipIdByProgram.set(spec.programName, card.id);
  }
  return MEMBERSHIPS.length;
}

export async function writeHomePlaces(ctx: SeedContext): Promise<number> {
  for (const { place, on } of HOME_PLACES) {
    const placeId = await ensurePlace(ctx, place, true);
    await prisma.placeVisit.create({
      data: {
        placeId,
        userId: ctx.userId,
        visitedAt: new Date(anchorDay(on, ctx.now).getTime() + 15 * 3_600_000),
        rating: place.rating ?? null,
      },
    });
  }
  for (const place of WISHLIST) await ensurePlace(ctx, place, false);
  return HOME_PLACES.length + WISHLIST.length;
}

async function placeIdsByName(ctx: SeedContext): Promise<Map<string, string>> {
  const rows = await prisma.place.findMany({
    where: { userId: ctx.userId },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.name, r.id]));
}

export async function writeLists(ctx: SeedContext): Promise<number> {
  const byName = await placeIdsByName(ctx);
  let lists = 0;
  for (const [sortIdx, spec] of OWN_LISTS.entries()) {
    const list = await prisma.placeList.create({
      data: {
        userId: ctx.userId,
        name: spec.name,
        color: spec.color,
        icon: spec.icon,
        description: spec.description || null,
        sortIdx,
      },
    });
    const members = spec.members.map((name) => {
      const id = byName.get(name);
      if (!id) throw new Error(`Demo seed: list ${spec.name} names ${name}, which no trip wrote`);
      return id;
    });
    await prisma.placeListEntry.createMany({
      data: members.map((placeId, i) => ({ listId: list.id, placeId, sortIdx: i })),
    });
    lists++;
  }

  // A subscribed checklist is one list row carrying the catalogue key, plus a
  // membership for every place already ticked from it — what the subscribe
  // route writes (`routes/placeLists/curated.ts`). Skipped when the catalogue
  // has not been seeded yet.
  for (const key of SUBSCRIBED_CHECKLISTS) {
    const curated = await prisma.curatedList.findUnique({ where: { key } });
    if (!curated) continue;
    const list = await prisma.placeList.create({
      data: {
        userId: ctx.userId,
        curatedKey: curated.key,
        name: curated.name,
        description: curated.description,
        icon: curated.icon,
        sortIdx: lists,
      },
    });
    const items = await prisma.curatedPlace.findMany({
      where: { listKey: key },
      select: { id: true, sortIdx: true },
    });
    const sortByItem = new Map(items.map((i) => [i.id, i.sortIdx]));
    const ticked = await prisma.place.findMany({
      where: { userId: ctx.userId, curatedItemId: { in: [...sortByItem.keys()] } },
      select: { id: true, curatedItemId: true },
    });
    await prisma.placeListEntry.createMany({
      data: ticked.map((p) => ({
        listId: list.id,
        placeId: p.id,
        sortIdx: sortByItem.get(p.curatedItemId ?? "") ?? 0,
      })),
    });
    lists++;
  }
  return lists;
}

/**
 * The inbox a long-time user has: every old question answered, two open.
 *
 * Ten years of trips give the suggestion engine plenty to ask about — a saved
 * café beside Köln Hbf on every train home, a viewpoint near a port called at
 * twice. A real user would long since have answered those; the demo answers
 * them the way the inbox's "no" does (`dismissSuggestion`), and leaves open
 * exactly the two it was built to show: the last work trip, never put into a
 * trip, and the monument beside the Edinburgh hotel.
 */
export const OPEN_SUGGESTIONS: ReadonlyArray<(s: TripSuggestion) => boolean> = [
  (s) => s.kind === "new_trip",
  (s) => s.kind === "place_visit" && s.place?.name === "Scott Monument",
];

export async function settleInbox(ctx: SeedContext): Promise<{ open: number; answered: number }> {
  invalidateTripSuggestions(ctx.userId);
  const { suggestions } = await computeTripSuggestions(ctx.userId);
  let answered = 0;
  for (const suggestion of suggestions) {
    if (OPEN_SUGGESTIONS.some((keep) => keep(suggestion))) continue;
    await dismissSuggestion(ctx.userId, suggestion);
    answered++;
  }
  invalidateTripSuggestions(ctx.userId);
  return { open: suggestions.length - answered, answered };
}
