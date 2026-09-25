import { api } from "./client";
import type { RouteKind, TourActivity, RoadtripVehicle } from "../../shared/tour/roadtrip";
import type { TourRoute } from "../../types/tour";
import type {
  CreateRoadtripInput,
  RoadtripDetail,
  RoadtripNights,
  RoadtripStation,
  RoadtripSummary,
  StationInput,
} from "../../types/roadtrip";
import type { TourLeg } from "../../types/tour";

/**
 * The roadtrip endpoints (2.7). Everything a roadtrip shares with a tour —
 * legs, routing, tracks, geometry, rename, delete — stays on `toursApi`
 * with the standalone `/tours/:routeId` path, because a roadtrip is a tour
 * route underneath; this client covers only what is new.
 */
export const roadtripsApi = {
  list: async (): Promise<RoadtripSummary[]> => {
    const { data } = await api.get<{ roadtrips: RoadtripSummary[] }>("/roadtrips");
    return data.roadtrips;
  },

  get: async (id: string): Promise<RoadtripDetail> => {
    const { data } = await api.get<RoadtripDetail>(`/roadtrips/${id}`);
    return data;
  },

  create: async (input: CreateRoadtripInput): Promise<TourRoute> => {
    const { data } = await api.post<{ roadtrip: TourRoute }>("/roadtrips", input);
    return data.roadtrip;
  },

  /** The complete, ordered station list — replaces whatever was there. */
  replaceStations: async (
    id: string,
    stations: StationInput[]
  ): Promise<{
    roadtrip: TourRoute;
    nights: RoadtripNights;
    stations: RoadtripStation[];
    legs: TourLeg[];
  }> => {
    const { data } = await api.put<{
      roadtrip: TourRoute;
      nights: RoadtripNights;
      stations: RoadtripStation[];
      legs: TourLeg[];
    }>(`/roadtrips/${id}/stations`, { stations });
    return data;
  },

  /** Move a row between the tour and roadtrip pages; clears the migration flag. */
  switchKind: async (
    routeId: string,
    input: { kind: RouteKind; activity?: TourActivity | null; vehicle?: RoadtripVehicle | null }
  ): Promise<TourRoute> => {
    const { data } = await api.patch<{ route: TourRoute }>(`/tours/${routeId}/kind`, input);
    return data.route;
  },

  /** Keep the kind the 2.7 migration chose. */
  confirmKind: async (routeId: string): Promise<TourRoute> => {
    const { data } = await api.post<{ route: TourRoute }>(`/tours/${routeId}/kind/confirm`);
    return data.route;
  },
};

/** A station as the list endpoint wants it back, from what the detail returned. */
export function toStationInput(station: RoadtripStation): StationInput {
  return {
    id: station.id,
    title: station.title,
    // A route station always has a coordinate — the station and assign
    // endpoints both refuse one without — so there is nothing to invent here.
    lat: station.lat as number,
    lon: station.lon as number,
    startDate: station.startDate,
    endDate: station.endDate,
    notes: station.notes,
    night:
      station.state === "stay" && station.lodgingStayId
        ? { kind: "stay", lodgingStayId: station.lodgingStayId }
        : station.state === "free"
          ? { kind: "free" }
          : { kind: "pass" },
  };
}
