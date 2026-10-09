/** Shapes of the roadtrip insights (forgejo#260). Loader: `services/stats/insights/roadtripInsightData.ts`. */
import type { RoadtripPhase } from "../../shared/tour/roadtripTimeline";

export interface InsightStation {
  id: string;
  title: string;
  lat: number | null;
  lon: number | null;
  startDate: Date | null;
  endDate: Date | null;
  stopZone: string | null;
  overnight: boolean;
  viaPoint: boolean;
  lodgingStayId: string | null;
  lodgingStay: {
    id: string;
    checkIn: Date | null;
    checkOut: Date | null;
    datePrecision: string;
    nights: number | null;
    status: string;
    lodging: { type: string; isoCountryCode: string | null };
  } | null;
}

export interface InsightLeg {
  fromStopId: string;
  toStopId: string;
  mode: string;
  source: string;
  distanceKm: number;
}

export interface InsightRoadtrip {
  id: string;
  name: string;
  vehicle: string | null;
  /** In route order, route corrections included — legs run through them. */
  stations: InsightStation[];
  legs: InsightLeg[];
}

/**
 * Kilometres by where they stand: `recorded` has happened (by the timeline
 * rule, undated legs of a finished roadtrip included), `current` is today's,
 * `planned` lies ahead, `unplaced` is undated on a roadtrip still under way.
 */
export interface PhaseKm {
  recorded: number;
  current: number;
  planned: number;
  unplaced: number;
}

export interface RoadtripRow {
  id: string;
  name: string;
  /** Year it started — the tab's year rule; null when undated. */
  year: number | null;
  /** `YYYY-MM-DD` of the first dated station, at that station; null when none is dated. */
  firstDay: string | null;
  phase: RoadtripPhase;
  /** Every mode: what was travelled. The badges' `roadtrip_km` reads `recorded`. */
  km: PhaseKm;
  /** Road legs only: what the vehicle itself drove. */
  roadKm: PhaseKm;
  /** Recorded km per distance source: straight | drawn | routed | track. */
  kmBySource: Record<string, number>;
  /** Recorded km per leg mode: road | ferry | rail | foot | bike. */
  kmByMode: Record<string, number>;
  nights: { recorded: number; planned: number };
  nightsByStyle: { pitch: number; campsite: number; lodging: number };
  unknownLengthStations: number;
  countries: { recorded: string[]; planned: string[] };
  /** Days with no change of place, or null when not every station is dated. */
  restDays: number | null;
  tours: { completed: number; km: number; ascentM: number | null };
}

export interface DayStage {
  roadtripId: string;
  name: string;
  day: string;
  km: number;
}

export interface RoadtripInsights {
  roadtrips: RoadtripRow[];
  pace: {
    dayStages: number;
    medianDayKm: number | null;
    longestDay: DayStage | null;
    /** Recorded stretches whose two ends are not on one known day — no day stage. */
    unstagedLegs: number;
    restDays: number;
    /** Roadtrips whose every station is dated — the only ones a rest day can be read from. */
    fullyDatedTrips: number;
  };
  awards: {
    roadtripsCount: number;
    recordedKm: number;
    longestRecordedKm: number;
    recordedFreeNights: number;
    recordedCountriesMax: number;
    baseCampStations: number;
    landAndWaterTrips: number;
    tourStations: number;
  };
}
