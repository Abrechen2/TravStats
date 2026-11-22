import type { ActivityFeedItem } from "../../../lib/api/activityFeed";
import { busApi } from "../../../lib/api/bus";
import { ferryApi } from "../../../lib/api/ferry";
import { railApi } from "../../../lib/api/rail";
import { rentalApi } from "../../../lib/api/rental";
import { tourIndexApi } from "../../../lib/api/tourIndex";
import { hexToRgb } from "../../../lib/domainColor";
import type { MapFocusTarget } from "../../../store/mapFocusStore";
import type { FilterDomainKey } from "../../../shared/dashboardDomainFilter";
import type { Flight } from "../../../types";
import type { Cruise } from "../../../types/cruise";
import type { Lodging } from "../../../types/lodging";
import type { Place } from "../../../types/place";
import {
  journeyFromBus,
  journeyFromFerry,
  journeyFromRail,
  journeyFromRental,
} from "../../map/cards/journeys/journeyNormalize";
import { groupRoutes, journeyRoutePinned } from "../../map/cards/journeys/journeyLayerCards";
import { tourCardDatum, tourPinned } from "../../map/cards/journeys/tourLayerCards";
import type { MapJourney } from "../../map/cards/journeys/journeyTypes";
import type { MapPinned } from "../../map/cards/pinnedTypes";

/**
 * What a click on an activity-list row does, in one place so every domain
 * answers it the same way: make the entry's layer visible, bring the camera to
 * it, and open the card the map opens for that entry.
 *
 * Flights, cruises, stays and places already have a selection store the map
 * reads (a card plus its own camera move), so the row writes there — never a
 * second card host. Rail, bus, ferry, rentals and tours open theirs through the
 * layer-card store, from the entry fetched by id (the list carries no more than
 * a row needs). The camera is the row's own request on top, so the same point
 * or box is framed whatever the domain.
 */

export interface FeedSelectDeps {
  /** Full flight by id, from the rows the tab already loaded. */
  findFlight: (id: string) => Flight | undefined;
  cruises: readonly Cruise[];
  lodgings: readonly Lodging[];
  places: readonly Place[];
  selectFlight: (flights: Flight[]) => void;
  selectCruise: (cruise: Cruise) => void;
  selectLodging: (lodging: Lodging) => void;
  selectPlace: (place: Place) => void;
  /** Opens a card a layer would open (rail, bus, ferry, rental, tours). */
  selectLayerCard: (pinned: MapPinned) => void;
  /** Whether the domain's layer is on the map right now. */
  isDomainOnMap: (domain: FilterDomainKey) => boolean;
  /** Switches the domain's layer on. */
  showDomain: (domain: FilterDomainKey) => void;
  focus: (target: MapFocusTarget) => void;
  colorOf: (domain: FilterDomainKey) => string;
  /** Pixels the list covers on the map's left edge. */
  leftInset: number;
  /** False once a newer click has replaced this one — a slow fetch must not overwrite it. */
  isCurrent: () => boolean;
}

/**
 * - `selected`: the entry's card is open (and the camera on its way).
 * - `switchedOn`: as `selected`, and the domain's layer had to be switched on first.
 * - `notLoaded`: the entry is not among the rows this tab loaded (nothing opened).
 * - `superseded`: a newer click replaced this one while it was fetching; nothing was opened.
 * - `unplaced`: the entry has no coordinates, so there is nothing to show on the map.
 */
export type FeedSelectOutcome = "selected" | "switchedOn" | "notLoaded" | "superseded" | "unplaced";

function anchorOf(item: ActivityFeedItem): [number, number] | null {
  if (item.point) return [item.point.lon, item.point.lat];
  if (item.bbox) return [(item.bbox[0] + item.bbox[2]) / 2, (item.bbox[1] + item.bbox[3]) / 2];
  return null;
}

async function journeyOf(item: ActivityFeedItem): Promise<MapJourney> {
  switch (item.domain) {
    case "rail":
      return journeyFromRail(await railApi.get(item.id));
    case "bus":
      return journeyFromBus(await busApi.get(item.id));
    case "ferry":
      return journeyFromFerry(await ferryApi.get(item.id));
    default:
      return journeyFromRental(await rentalApi.get(item.id));
  }
}

/** The card a layer click on this entry would open; null when the entry cannot be found. */
async function layerCardOf(
  item: ActivityFeedItem,
  anchor: [number, number],
  deps: FeedSelectDeps
): Promise<MapPinned | null> {
  const color = hexToRgb(deps.colorOf(item.domain as FilterDomainKey));
  if (item.domain === "tour" || item.domain === "roadtrip") {
    const tours = await tourIndexApi.list(item.domain);
    const tour = tours.find((t) => t.id === item.id);
    return tour ? tourPinned(tourCardDatum(tour, color), anchor) : null;
  }
  const journey = await journeyOf(item);
  return journeyRoutePinned(groupRoutes([journey]), journey, color, anchor);
}

/**
 * Rejects when a fetch behind a ground or tour entry fails — the caller says
 * so; an entry that could not be opened must never look like one that was.
 */
export async function selectFeedItem(
  item: ActivityFeedItem,
  deps: FeedSelectDeps
): Promise<FeedSelectOutcome> {
  const anchor = anchorOf(item);
  if (anchor === null) return "unplaced";

  const domain = item.domain as FilterDomainKey;
  const wasOnMap = deps.isDomainOnMap(domain);
  if (!wasOnMap) deps.showDomain(domain);

  switch (item.domain) {
    case "flight": {
      const flight = deps.findFlight(item.id);
      if (!flight) return "notLoaded";
      deps.selectFlight([flight]);
      break;
    }
    case "cruise": {
      const cruise = deps.cruises.find((c) => c.id === item.subjectId);
      if (!cruise) return "notLoaded";
      deps.selectCruise(cruise);
      break;
    }
    case "lodging": {
      const lodging = deps.lodgings.find((l) => l.id === item.subjectId);
      if (!lodging) return "notLoaded";
      deps.selectLodging(lodging);
      break;
    }
    case "poi": {
      const place = deps.places.find((p) => p.id === item.subjectId);
      if (!place) return "notLoaded";
      deps.selectPlace(place);
      break;
    }
    default: {
      const pinned = await layerCardOf(item, anchor, deps);
      if (!deps.isCurrent()) return "superseded";
      if (!pinned) return "notLoaded";
      deps.selectLayerCard(pinned);
    }
  }

  deps.focus({ point: item.point, bbox: item.bbox, leftInset: deps.leftInset });
  return wasOnMap ? "selected" : "switchedOn";
}
