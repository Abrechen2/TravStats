import type { SummaryFigure } from "../../components/table/ListSummaryStrip";
import type { RoadtripSummary } from "../../types/roadtrip";

/** Counts above the roadtrip list, from the rows shown — no distance, which mixes measured and drawn legs. */
export function roadtripSummaryFigures(
  rows: readonly RoadtripSummary[],
  labels: {
    roadtrips: (count: number) => string;
    countries: (count: number) => string;
    stations: (count: number) => string;
  }
): SummaryFigure[] {
  const countries = new Set(rows.flatMap((r) => r.countries));
  const stations = rows.reduce((sum, r) => sum + r.stationCount, 0);
  return [
    { key: "roadtrips", value: String(rows.length), label: labels.roadtrips(rows.length) },
    { key: "countries", value: String(countries.size), label: labels.countries(countries.size) },
    { key: "stations", value: String(stations), label: labels.stations(stations) },
  ];
}
