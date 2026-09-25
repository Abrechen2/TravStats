// Barrel export for the domain-stats pipeline.
export type { DomainKpi, DomainStats, DomainStatsMap, DomainSummary, YearScopedAgg } from "./types";
export { adaptFlight, type FlightAdapterInput } from "./flightStatsAdapter";
export { adaptCruise, type CruiseAdapterInput } from "./cruiseStatsAdapter";
export { adaptLodging, type LodgingAdapterInput } from "./lodgingStatsAdapter";
export { adaptPoi } from "./poiStatsAdapter";
export { adaptRoadtrip, type RoadtripAdapterInput } from "./roadtripStatsAdapter";
export { useDomainStats, type UseDomainStatsResult } from "./useDomainStats";
