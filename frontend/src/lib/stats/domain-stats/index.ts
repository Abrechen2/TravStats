// Barrel export for the domain-stats pipeline.
export type { DomainStats, DomainStatsMap, DomainSummary, YearScopedAgg } from "./types";
export { adaptFlight, type FlightAdapterInput } from "./flightStatsAdapter";
export { adaptCruise, type CruiseAdapterInput } from "./cruiseStatsAdapter";
export { adaptLodging, type LodgingAdapterInput } from "./lodgingStatsAdapter";
export { adaptPoi } from "./poiStatsAdapter";
export { useDomainStats, type UseDomainStatsResult } from "./useDomainStats";
