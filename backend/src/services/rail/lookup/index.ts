import { getInstanceSettings } from "../../instanceSettingsService";
import { AppError } from "../../../middleware/errorHandler";
import { timezoneOfLodging } from "../../../utils/stayInstant";
import { instantToWallClock } from "../railJourneyWrite";
import { catalogueStationAt, findStation } from "../railStations";
import { lookupDbRest } from "./dbRest";
import { lookupTransitous } from "./transitous";
import { parseTrainNumber } from "./trainNumber";
import type {
  ProviderResult,
  ProviderStop,
  RailLookupOutcome,
  RailLookupProvider,
  RailLookupQuery,
} from "./types";

/**
 * The train-number lookup chain (spec 2026-09-25-rail-domain): Transitous,
 * then db-rest, each falling through on a miss; manual entry is what the form
 * is when both miss. Which providers may be asked is the admin's choice
 * (`admin_settings.rail_*_enabled`), because each call sends a station and a
 * date from a self-hosted instance to a third party.
 */

export interface RailProviderSwitches {
  transitous: boolean;
  dbRest: boolean;
}

export async function railProviderSwitches(): Promise<RailProviderSwitches> {
  const settings = await getInstanceSettings();
  return { transitous: settings.railTransitousEnabled, dbRest: settings.railDbRestEnabled };
}

export interface RailLookupInput {
  trainNumber: string;
  category?: string | null;
  date: string;
  from: { lat: number; lon: number; stationId?: number | null };
}

/** A stop as the form can take it over: a station plus its planned times. */
export interface RailLookupStop {
  name: string;
  lat: number;
  lon: number;
  stationId: number | null;
  code: string | null;
  country: string | null;
  /** The station clock, `YYYY-MM-DDTHH:mm` — what the form's time fields hold. */
  arrivalLocal: string | null;
  departureLocal: string | null;
}

export interface RailLookupMatch {
  provider: RailLookupProvider;
  ref: string;
  operator: string | null;
  trainCategory: string | null;
  trainNumber: string | null;
  stops: RailLookupStop[];
  boardingIndex: number;
  hasGeometry: boolean;
}

export interface RailLookupAnswer {
  match: RailLookupMatch | null;
  attempts: Array<{ provider: RailLookupProvider; outcome: RailLookupOutcome }>;
}

type Provider = {
  id: RailLookupProvider;
  enabled: (s: RailProviderSwitches) => boolean;
  /** db-rest is a German service; elsewhere it has nothing to say. */
  applies: (country: string | null) => boolean;
  run: (query: RailLookupQuery) => Promise<ProviderResult>;
};

const CHAIN: readonly Provider[] = [
  { id: "transitous", enabled: (s) => s.transitous, applies: () => true, run: lookupTransitous },
  {
    id: "db-rest",
    enabled: (s) => s.dbRest,
    applies: (country) => country === null || country === "DE",
    run: lookupDbRest,
  },
];

async function toLookupStop(stop: ProviderStop): Promise<RailLookupStop> {
  const catalogue = await catalogueStationAt(stop.lat, stop.lon);
  const zone = timezoneOfLodging(stop.lat, stop.lon);
  return {
    name: stop.name,
    lat: stop.lat,
    lon: stop.lon,
    stationId: catalogue?.id ?? null,
    code: catalogue?.uic ?? null,
    country: catalogue?.country ?? null,
    arrivalLocal: stop.plannedArrival ? instantToWallClock(stop.plannedArrival, zone) : null,
    departureLocal: stop.plannedDeparture ? instantToWallClock(stop.plannedDeparture, zone) : null,
  };
}

export async function lookupTrain(input: RailLookupInput): Promise<RailLookupAnswer> {
  const parsed = parseTrainNumber(input.trainNumber, input.category);
  if (!parsed) throw new AppError("trainNumber carries no number", 400);

  const station = input.from.stationId ? await findStation(input.from.stationId) : null;
  if (input.from.stationId && !station) throw new AppError("Unknown station", 400);
  const from = station
    ? { lat: station.lat, lon: station.lon, dbId: station.dbId }
    : { lat: input.from.lat, lon: input.from.lon, dbId: null };
  const query: RailLookupQuery = {
    ...parsed,
    date: input.date,
    from,
    timezone: timezoneOfLodging(from.lat, from.lon),
  };

  const switches = await railProviderSwitches();
  const attempts: RailLookupAnswer["attempts"] = [];
  for (const provider of CHAIN) {
    if (!provider.enabled(switches)) {
      attempts.push({ provider: provider.id, outcome: "disabled" });
      continue;
    }
    if (!provider.applies(station?.country ?? null)) {
      attempts.push({ provider: provider.id, outcome: "notApplicable" });
      continue;
    }
    const result = await provider.run(query);
    attempts.push({ provider: provider.id, outcome: result.outcome });
    if (result.outcome === "matched") {
      const { trip } = result;
      // Sequential on purpose: one small catalogue query per stop, and a
      // train rarely has more than thirty.
      const stops: RailLookupStop[] = [];
      for (const stop of trip.stops) stops.push(await toLookupStop(stop));
      return {
        match: {
          provider: trip.provider,
          ref: trip.ref,
          operator: trip.operator,
          trainCategory: trip.category,
          trainNumber: trip.number,
          stops,
          boardingIndex: trip.boardingIndex,
          hasGeometry: trip.hasGeometry,
        },
        attempts,
      };
    }
  }
  return { match: null, attempts };
}
