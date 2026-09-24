// Frontend view of the roadtrip domain (2.7). Mirrors the DTOs of
// backend/src/routes/roadtrips/*.ts and services/roadtrip/roadtripSummary.ts.
// A roadtrip IS a tour route (`TourRoute` with `kind: "roadtrip"`); these are
// the shapes only the roadtrip endpoints return.

import type { RoadtripVehicle, StationState, TourActivity } from "../shared/tour/roadtrip";
import type { TourLeg, TourRoute } from "./tour";

export interface RoadtripNights {
  /** Nights at linked stays — the SAME figure the lodging statistics hold. */
  stayNights: number;
  /** Nights at stations with no accommodation record. */
  freeNights: number;
  nights: number;
  /** False once any overnight station's length is not actually known. */
  nightsKnown: boolean;
  placesSlept: number;
}

export interface RoadtripSummary extends RoadtripNights {
  id: string;
  kind: "roadtrip";
  tripId: string | null;
  tripName: string | null;
  name: string;
  mode: string;
  color: string | null;
  vehicle: RoadtripVehicle | null;
  vehicleName: string | null;
  kindAssignedAutomatically: boolean;
  startDate: string | null;
  endDate: string | null;
  distanceKm: number;
  drivenKm: number;
  startOdometerKm: number | null;
  endOdometerKm: number | null;
  stationCount: number;
  trackCount: number;
  tourCount: number;
  /** ISO alpha-2 codes of the countries its stations stand in. */
  countries: string[];
}

export interface StationStay {
  id: string;
  lodgingId: string;
  lodgingName: string;
  lodgingType: string;
  city: string | null;
  country: string | null;
  checkIn: string | null;
  checkOut: string | null;
  nights: number | null;
  status: string;
}

export interface RoadtripStation {
  id: string;
  title: string;
  lat: number | null;
  lon: number | null;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  order: number | null;
  state: StationState;
  lodgingStayId: string | null;
  stay: StationStay | null;
}

export interface RoadtripDayTour {
  id: string;
  name: string;
  activity: TourActivity | null;
  anchorStopId: string | null;
  distanceKm: number;
  ascentM: number | null;
  startedAt: string | null;
}

export interface RoadtripDetail {
  roadtrip: TourRoute;
  countries: string[];
  trip: { id: string; name: string } | null;
  startDate: string | null;
  endDate: string | null;
  nights: RoadtripNights;
  stations: RoadtripStation[];
  legs: TourLeg[];
  tours: RoadtripDayTour[];
  routingAvailable: boolean;
}

/** A station's night as the station list accepts it. */
export type StationNightInput =
  { kind: "stay"; lodgingStayId: string } | { kind: "free" } | { kind: "pass" };

export interface StationInput {
  /** Omitted for a new station. */
  id?: string;
  title: string;
  lat: number;
  lon: number;
  startDate?: string | null;
  endDate?: string | null;
  notes?: string | null;
  night: StationNightInput;
}

export interface CreateRoadtripInput {
  name: string;
  vehicle?: RoadtripVehicle | null;
  vehicleName?: string | null;
  color?: string;
  notes?: string;
  tripId?: string | null;
}
