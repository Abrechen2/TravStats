import { api } from "./client";
import type {
  CountedTours,
  LodgingInsights,
  PlaceInsights,
  RoadtripInsights,
  TourInsights,
} from "../../types/statsInsights";

/**
 * The statistics expansion (forgejo#258/#259/#260/#264). Every answer is
 * lifetime with per-year series; the tab picks the year it shows.
 */
export const statsInsightsApi = {
  lodging: async (): Promise<LodgingInsights> => {
    const { data } = await api.get<LodgingInsights>("/stats/insights/lodging");
    return data;
  },
  places: async (): Promise<PlaceInsights> => {
    const { data } = await api.get<PlaceInsights>("/stats/insights/places");
    return data;
  },
  roadtrips: async (): Promise<RoadtripInsights> => {
    const { data } = await api.get<RoadtripInsights>("/stats/insights/roadtrips");
    return data;
  },
  /** The tours the overview counts, one row each; 404 while the tour domain is not shown. */
  toursCounted: async (): Promise<CountedTours> => {
    const { data } = await api.get<CountedTours>("/stats/insights/tours/counted");
    return data;
  },
  tours: async (): Promise<TourInsights> => {
    const { data } = await api.get<TourInsights>("/stats/insights/tours");
    return data;
  },
};
