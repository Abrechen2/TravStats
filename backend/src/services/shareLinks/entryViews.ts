import { prisma } from "../../db";
import type { CruiseView, ShareLinkField, StayView, VisitView } from "../../schemas/shareLinks";
import { visitTime } from "../places/timesDto";
import { cruiseItemsWhere, NOT_CANCELLED, stayItemsWhere } from "./itineraryView";

/**
 * The public view of ONE cruise, lodging stay or place visit (forgejo#405) —
 * the family of the flight link, for entries that have no live phase.
 *
 * Like the flight view, built field by field from the owner's selection. The
 * cruise and the stay come through the itinerary's own builders
 * (`itineraryView.ts`), whose selects already leave out price, booking
 * reference, cabin or room number, document, note and companion; this file
 * only cuts what the owner did not tick. A visit has its own select, because
 * the itinerary's carries no rating or country.
 *
 * Every function answers null for an entry that is not the caller's, is
 * cancelled, or does not exist — one answer, so the owner side is no oracle
 * either. These links end only at the owner's chosen date: the entries hold no
 * live state that makes an earlier end meaningful.
 */

export async function buildCruiseView(
  userId: string,
  cruiseId: string,
  fields: ReadonlySet<ShareLinkField<"cruise">>,
  owner: string | null
): Promise<CruiseView | null> {
  const [cruise] = await cruiseItemsWhere({ id: cruiseId, userId, ...NOT_CANCELLED });
  if (!cruise) return null;
  const view: CruiseView = {};
  if (fields.has("owner")) view.owner = owner;
  if (fields.has("ship")) view.ship = { name: cruise.ship, line: cruise.cruiseLine };
  if (fields.has("dates")) view.dates = { start: cruise.start, end: cruise.end };
  if (fields.has("ports")) {
    view.ports = cruise.ports.map((p) => ({
      dayNumber: p.dayNumber,
      name: p.name,
      atSea: p.atSea,
      day: p.day,
    }));
  }
  return view;
}

export async function buildStayView(
  userId: string,
  stayId: string,
  fields: ReadonlySet<ShareLinkField<"stay">>,
  owner: string | null
): Promise<StayView | null> {
  const [stay] = await stayItemsWhere({ id: stayId, userId, ...NOT_CANCELLED });
  if (!stay) return null;
  const view: StayView = {};
  if (fields.has("owner")) view.owner = owner;
  if (fields.has("name")) view.name = stay.name;
  if (fields.has("location")) {
    view.location = { address: stay.address, city: stay.city, country: stay.country };
  }
  if (fields.has("dates")) view.dates = { checkIn: stay.checkIn, checkOut: stay.checkOut };
  return view;
}

export async function buildVisitView(
  userId: string,
  visitId: string,
  fields: ReadonlySet<ShareLinkField<"visit">>,
  owner: string | null
): Promise<VisitView | null> {
  const visit = await prisma.placeVisit.findFirst({
    where: { id: visitId, userId },
    select: {
      visitedAt: true,
      visitedAtUtc: true,
      visitedZone: true,
      visitedPrecision: true,
      rating: true,
      place: { select: { name: true, city: true, country: true } },
    },
  });
  if (!visit) return null;
  const view: VisitView = {};
  if (fields.has("owner")) view.owner = owner;
  if (fields.has("place")) {
    view.place = {
      name: visit.place.name,
      city: visit.place.city,
      country: visit.place.country,
    };
  }
  if (fields.has("date")) view.date = visitTime(visit);
  if (fields.has("rating")) view.rating = visit.rating;
  return view;
}
