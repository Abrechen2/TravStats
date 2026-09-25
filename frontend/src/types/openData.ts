/** Mirrors backend `services/openData/journalWeather.ts` `ObservedWeather`. */
export interface ObservedWeather {
  /** WMO weather interpretation code. */
  code: number;
  tMaxC: number;
  tMinC: number;
  precipMm: number;
  place: string;
  lat: number;
  lon: number;
  source: "open-meteo";
  fetchedAt: string;
}
