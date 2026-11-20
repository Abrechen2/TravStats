// What a click on the trip map opens: the entry's card data and where it leads.
//
// A link into the timeline needs an anchor the timeline really has — its rows
// carry `id="timeline-<event id>"` (`lib/tripTimelineEvents.ts` names the ids) —
// so the ids built here must stay the timeline's. Off a trip page (a tour or a
// roadtrip page has no timeline) there is no timeline link.

import type { TripMapInfo } from "../../store/tripMapInfoStore";
import type { DaySpan } from "./tripMapDays";

export const timelineHref = (tripId: string | undefined, eventId: string | null): string | null =>
  tripId && eventId ? `/trips/${tripId}?tab=timeline#timeline-${eventId}` : null;

export function lodgingInfo(args: {
  id: string;
  name: string;
  city: string | null;
  span: DaySpan | null;
  stayId: string;
  tripId?: string;
}): TripMapInfo {
  return {
    key: `lodging:${args.id}`,
    kind: "lodging",
    title: args.name,
    subtitle: args.city,
    span: args.span,
    entityHref: `/lodging/${args.id}`,
    timelineHref: timelineHref(args.tripId, `lodging-checkin-${args.stayId}`),
  };
}

export function cruiseInfo(args: {
  id: string;
  title: string;
  span: DaySpan | null;
  tripId?: string;
}): TripMapInfo {
  return {
    key: `cruise:${args.id}`,
    kind: "cruise",
    title: args.title,
    span: args.span,
    entityHref: `/cruises/${args.id}`,
    timelineHref: timelineHref(args.tripId, `cruise-${args.id}`),
  };
}

/** `key` is the data's `stop:<id>`; a stop with no id of its own has no timeline row to link. */
export function stopInfo(args: {
  key: string;
  title: string;
  span: DaySpan | null;
  tripId?: string;
}): TripMapInfo {
  const id = args.key.slice("stop:".length);
  return {
    key: args.key,
    kind: "stop",
    title: args.title,
    span: args.span,
    entityHref: null,
    timelineHref: /^\d+$/.test(id) ? null : timelineHref(args.tripId, `stop-${id}`),
  };
}

export function placeInfo(args: {
  id: string;
  visitId: string;
  name: string;
  subtitle: string | null;
  span: DaySpan | null;
  tripId?: string;
}): TripMapInfo {
  return {
    key: `place:${args.id}`,
    kind: "place",
    title: args.name,
    subtitle: args.subtitle,
    span: args.span,
    entityHref: `/places/${args.id}`,
    timelineHref: timelineHref(args.tripId, `place-visit-${args.visitId}`),
  };
}
