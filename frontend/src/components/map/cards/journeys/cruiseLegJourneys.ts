// A cruise leg in the journey model (forgejo#323).
//
// A flight route's hover names both airports and "3× geflogen · 1× geplant";
// a cruise leg's said only the line's name. A leg runs between two ports the
// way a ferry crossing does, so it is read into the same `MapJourney` and
// spoken by the same hover builder — no cruise tooltip of its own to drift.
// A click on a leg still opens the cruise's own card: the reader tapping a
// cruise line means that cruise.

import { effectiveTimedSequence, type EffectiveSequenceEntry } from "../../../Cruise/cruisePorts";
import { dateOfCruiseDay } from "../../../Cruise/cruiseDayNumbers";
import { cruiseStart } from "../../../../lib/entityTimes";
import { isCountableCruiseStatus } from "../../../../shared/cruiseCounting";
import { timeValueFromWallClock, type TimeValue } from "../../../../shared/time";
import type { Rgb } from "../../../../lib/domainColor";
import type { Cruise, Port } from "../../../../types/cruise";
import { tallyJourneys } from "./journeyStats";
import { journeyRouteHoverHtml } from "./journeyHoverHtml";
import {
  journeyRouteProfile,
  type JourneyRouteHover,
  type JourneyRouteProfile,
} from "./journeyLayerCards";
import { cruiseHoverHtml } from "../hoverCardHtml";
import type { JourneyEnd, MapJourney } from "./journeyTypes";

/** What a leg needs of a cruise — the dashboard's full row or a trip's slimmer one. */
export type CruiseLegSource = Pick<Cruise, "id" | "cruiseLine" | "startDate"> & {
  /** Plain text: a trip row carries it as `string`; the counting rule takes a string. */
  status: string;
} & Partial<
    Pick<
      Cruise,
      "endDate" | "times" | "ship" | "shipNameOverride" | "departurePort" | "arrivalPort" | "stops"
    >
  >;

/** A drawn leg: the port ids at its ends and the colour the cruise colour store gave it. */
export interface CruiseLegDatum {
  fromPortId?: number;
  toPortId?: number;
  color?: Rgb;
}

/**
 * A port by its name. Unlike an airport's IATA code, nobody reads a UN/LOCODE
 * ("DKCPH", "DEKEL" — the beta.29 hover), so it is no second label here; it
 * stands in only for a port that has no name (see `map/portLabel.ts`).
 */
function endOf(port: Port): JourneyEnd {
  const name = port.name?.trim();
  return {
    name: name || port.unlocode || "?",
    code: null,
    country: port.country,
    lat: port.lat,
    lon: port.lon,
  };
}

/**
 * When a leg left its port: the stop's own departure clock, else its day of
 * the cruise (day 1 is the start date), as a day. Null when neither is known.
 */
function legDeparture(cruise: CruiseLegSource, entry: EffectiveSequenceEntry): TimeValue | null {
  const day = dateOfCruiseDay(
    cruiseStart({ ...cruise, endDate: cruise.endDate ?? null })?.date,
    entry.dayNumber
  );
  return timeValueFromWallClock(entry.departureTime) ?? (day ? timeValueFromWallClock(day) : null);
}

/** The legs of one cruise with their ports' ids; a night in port is no leg. */
function cruiseLegs(
  cruise: CruiseLegSource
): { journey: MapJourney; fromId: number; toId: number }[] {
  const sequence = effectiveTimedSequence({ ...cruise, stops: cruise.stops ?? [] } as Cruise);
  const travelled = isCountableCruiseStatus(cruise.status);
  const out: { journey: MapJourney; fromId: number; toId: number }[] = [];
  for (let i = 0; i < sequence.length - 1; i++) {
    const a = sequence[i];
    const b = sequence[i + 1];
    if (a.port.id === b.port.id) continue;
    const departure = legDeparture(cruise, a);
    const journey: MapJourney = {
      id: cruise.id,
      domain: "cruise",
      dep: endOf(a.port),
      arr: endOf(b.port),
      departureTime: departure?.utc ?? null,
      departure,
      arrival: timeValueFromWallClock(b.arrivalTime),
      status: cruise.status,
      // The leg's sea distance is not on the cruise row — unknown, never 0.
      distanceKm: null,
      distanceSource: null,
      operator: cruise.cruiseLine,
      travelled,
      planned: !travelled && cruise.status !== "cancelled",
      facts: { vesselName: cruise.ship?.name ?? cruise.shipNameOverride ?? null },
    };
    out.push({ journey, fromId: a.port.id, toId: b.port.id });
  }
  return out;
}

/** One journey per leg of the cruise's itinerary; a night in port is no leg. */
export function journeysFromCruise(cruise: CruiseLegSource): MapJourney[] {
  return cruiseLegs(cruise).map((leg) => leg.journey);
}

const pairKey = (a: number, b: number): string => (a <= b ? `${a}|${b}` : `${b}|${a}`);

/** Every cruise leg by its two ports (either direction), and each port's end by id. */
export interface CruiseLegIndex {
  legs: ReadonlyMap<string, MapJourney[]>;
  ports: ReadonlyMap<number, JourneyEnd>;
}

/** The legs of every cruise handed in; cancelled cruises left out. */
export function indexCruiseLegs(cruises: readonly CruiseLegSource[]): CruiseLegIndex {
  const legs = new Map<string, MapJourney[]>();
  const ports = new Map<number, JourneyEnd>();
  for (const cruise of cruises) {
    if (cruise.status === "cancelled") continue;
    for (const { journey, fromId, toId } of cruiseLegs(cruise)) {
      const key = pairKey(fromId, toId);
      legs.set(key, [...(legs.get(key) ?? []), journey]);
      ports.set(fromId, journey.dep);
      ports.set(toId, journey.arr);
    }
  }
  return { legs, ports };
}

/**
 * Each drawn leg with the hover a flight route has (`journeyRoute`), read by
 * `markerTooltip`'s decorated branch and the globe's and trip map's cruise
 * hover. A leg whose ports are not in the index is handed back as it was.
 */
export function withCruiseLegHover<D extends CruiseLegDatum>(
  data: readonly D[],
  index: CruiseLegIndex
): (D & { journeyRoute?: JourneyRouteHover })[] {
  const profiles = new Map<string, JourneyRouteProfile>();
  return data.map((d) => {
    if (d.fromPortId === undefined || d.toPortId === undefined) return d;
    const key = pairKey(d.fromPortId, d.toPortId);
    const legs = index.legs.get(key);
    const dep = index.ports.get(d.fromPortId);
    const arr = index.ports.get(d.toPortId);
    if (!legs?.length || !dep || !arr) return d;
    let profile = profiles.get(key);
    if (!profile) {
      profile = journeyRouteProfile(legs);
      profiles.set(key, profile);
    }
    // The ends in the direction the leg is drawn, so the hover reads from → to.
    const journeyRoute: JourneyRouteHover = {
      domain: "cruise",
      dep,
      arr,
      ...tallyJourneys(legs),
      color: d.color ?? DEFAULT_COLOR,
      profile,
    };
    return { ...d, journeyRoute };
  });
}

const DEFAULT_COLOR: Rgb = [255, 255, 255];

type TFn = (key: string, options?: Record<string, unknown>) => string;

/** A cruise leg's hover on the globe and the trip map: the journey hover, else the name. */
export function cruiseLegHoverHtml(
  datum: { journeyRoute?: JourneyRouteHover },
  fallbackLabel: string,
  t: TFn
): string {
  return datum.journeyRoute
    ? journeyRouteHoverHtml(datum.journeyRoute, { t })
    : cruiseHoverHtml(fallbackLabel);
}
