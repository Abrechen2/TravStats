// Where the trip map's colours come from — which is nowhere in this folder.
//
// `TripMap.tsx` used to own four of them: FLIGHT_RGB, CRUISE_RGB, AIRPORT_RGB
// and an eight-entry STOP_DOMAIN_RGB map. Two things were wrong with that, and
// both were visible. A user who set flights to teal in the map panel got teal
// on the dashboard and amber on the trip — the same flight, two colours, one
// screen apart. And the five per-transport tour colours the owner abolished on
// 2026-09-05 ("tours are ONE domain with ONE colour, the means of transport is
// carried by the ICON") were still alive in that map, four months after
// `tourPathsLayer.ts` deleted them.
//
// So every hue here is resolved by the SAME function the dashboard layers call:
// `resolveFlightColor` (lib/flightColor.ts), `resolveCruiseArcColor`
// (lib/cruiseColor.ts), `resolveAirportDotColor` (layers/markerDotStyle.ts) and
// the domain-colour store. Nothing in this file picks a colour; it only asks.
//
// A warden in `__tests__/TripMap.colors.test.ts` holds the component to it.

import { useMemo } from "react";
import {
  resolveFlightColor,
  type FlightColorConfig,
  type FrequencyTier,
} from "../../lib/flightColor";
import { resolveCruiseArcColor, type CruiseColorConfig, type Rgb } from "../../lib/cruiseColor";
import { type LodgingColorConfig } from "../../lib/lodgingColor";
import { hexToRgb, type DomainColorMap } from "../../lib/domainColor";
import { TOUR_COLOR, type DomainKey } from "../../shared/domains";
import { tokens } from "../../theme/tokens";
import { MAP_LAYER_COLORS } from "../../types/mapTheme";
import { resolveAirportDotColor } from "../layers/markerDotStyle";
import { loadLodgingColorConfig, loadMapAppearance } from "../map/mapAppearance";
import { useFlightColorStore } from "../../store/flightColorStore";
import { useCruiseColorStore } from "../../store/cruiseColorStore";
import { useDomainColors } from "../../hooks/useDomainColors";

/**
 * The frequency band a trip's flight is drawn at.
 *
 * Tier 2 is the user's colour itself (`TIER_MIX[2] === 0` in flightColor.ts).
 * A trip map aggregates nothing — one flight is one line — so there is no
 * frequency to encode, and any other band would be a claim about how often
 * this route is flown that the page has not measured. Showing the pick is the
 * only honest answer.
 */
const TRIP_FLIGHT_TIER: FrequencyTier = 2;

/** Non-data colours: an outline, a hover flash, a label. They say nothing
 *  about a flight, a cruise or a place, which is why they are constants and
 *  not resolvers — but they live here so the component itself writes no colour
 *  at all, and the warden can be absolute rather than a list of exceptions.
 *  Values are the ones the map already drew; the token names say what they
 *  were reaching for. */
export const TRIP_MAP_CHROME = {
  /** Marker rim against the basemap — the app's own ground colour. */
  outline: [...hexToRgb(tokens.color.bg), 255] as [number, number, number, number],
  /** deck.gl's `autoHighlight` flash on a pickable object. */
  highlight: [255, 255, 255, 80] as [number, number, number, number],
  /** Brighter flash for the small round markers, which have less area to
   *  carry it. */
  highlightStrong: [255, 255, 255, 100] as [number, number, number, number],
  /** Stop-name text, outlined against whatever the basemap does there. */
  labelText: [...hexToRgb(tokens.color.textBright), 255] as [number, number, number, number],
} as const;

/** What a trip map needs to know before it can colour anything. */
export interface TripMapColorConfig {
  flight: FlightColorConfig;
  cruise: CruiseColorConfig;
  lodging: LodgingColorConfig;
  domains: DomainColorMap;
  airport: Rgb;
}

/**
 * Subscribe to every colour source the trip map reads.
 *
 * The flight and cruise configs come from their Zustand stores, so a change
 * made in the dashboard's appearance panel reaches this map within the same
 * session — which is the whole reason those stores exist. The lodging config
 * and the airport-marker colour have no store yet and are read once from the
 * persisted appearance blob at mount, exactly as `DeckGLMap` seeds its own
 * state: this map has no appearance panel of its own to keep in step with.
 */
export function useTripMapColorConfig(): TripMapColorConfig {
  const flight = useFlightColorStore((s) => s.config);
  const cruise = useCruiseColorStore((s) => s.config);
  const { colors: domains } = useDomainColors();

  const stored = useMemo(
    () => ({
      lodging: loadLodgingColorConfig(),
      airport: resolveAirportDotColor(
        loadMapAppearance().airportColor ?? null,
        MAP_LAYER_COLORS.glassmorphism
      ),
    }),
    []
  );

  return useMemo(
    () => ({ flight, cruise, domains, lodging: stored.lodging, airport: stored.airport }),
    [flight, cruise, domains, stored]
  );
}

/** A trip's flight, through the shared flight-colour function. */
export function resolveTripFlightColor(
  flight: { status?: string | null },
  cfg: FlightColorConfig
): Rgb {
  return resolveFlightColor(
    {
      tier: TRIP_FLIGHT_TIER,
      // A single flight is "pure scheduled" exactly when it is scheduled —
      // the dashboard's mixed-route case (flown AND upcoming on one city
      // pair) cannot arise where each line is one flight.
      pureScheduled: flight.status === "scheduled",
      isHistorical: flight.status === "historical",
    },
    cfg
  );
}

/** A trip's cruise leg, through the shared cruise-colour function. */
export function resolveTripCruiseColor(
  cruise: { id: string; status: string; color?: string | null },
  cfg: CruiseColorConfig
): Rgb {
  return resolveCruiseArcColor(cruise, cfg);
}

/**
 * A trip STOP's colour.
 *
 * `TripStop.domain` is a free-form string on the wire, and what it holds is
 * either a domain key, a tour leg's means of transport, or nothing. The first
 * reads its domain's colour, the second reads the ONE tour colour (owner,
 * 2026-09-05 — the five that used to live here are what that ruling removed),
 * and the third is a place, so it reads the place colour rather than becoming
 * a fifth hue nobody chose.
 */
const DOMAIN_ALIASES: Readonly<Record<string, DomainKey>> = {
  poi: "poi",
  place: "poi",
  hotel: "lodging",
  lodging: "lodging",
  flight: "flight",
  cruise: "cruise",
  roadtrip: "roadtrip",
};

const TOUR_MODES: ReadonlySet<string> = new Set(["train", "road", "ferry", "hike", "bike", "tour"]);

export function resolveTripStopColor(domain: string | null, colors: DomainColorMap): Rgb {
  if (domain && TOUR_MODES.has(domain)) return hexToRgb(TOUR_COLOR);
  const key = domain ? DOMAIN_ALIASES[domain] : undefined;
  return hexToRgb(colors[key ?? "poi"]);
}
