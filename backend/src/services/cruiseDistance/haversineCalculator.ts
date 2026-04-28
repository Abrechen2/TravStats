import { haversineKm } from "../../shared/geo/haversine";
import type {
  ComputedLeg,
  DistanceCalculator,
  PortPoint,
} from "./types";

/**
 * Always-accepts fallback. Returns the great-circle distance with low
 * confidence — accurate for open-ocean approximations, badly off for
 * coastal/river/canal routings. Phases 2-4 supersede this for legs
 * where a real router applies.
 */
export const haversineCalculator: DistanceCalculator = {
  method: "haversine",
  routerVersion: "1.0.0",

  accepts(): boolean {
    return true;
  },

  async compute(from: PortPoint, to: PortPoint): Promise<ComputedLeg> {
    const distanceKm = haversineKm(
      { lat: from.lat, lon: from.lon },
      { lat: to.lat, lon: to.lon },
    );
    return {
      distanceKm,
      method: "haversine",
      routerVersion: this.routerVersion,
      dataVersion: null,
      confidence: "low",
      notes: null,
    };
  },
};
