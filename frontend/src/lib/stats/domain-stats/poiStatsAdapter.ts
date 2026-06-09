// Stub adapter for the points-of-interest domain. Real implementation
// lands in V2.X when the POI module ships. Returning hasData=false keeps
// the overview pipeline runnable without conditional branching.
import type { DomainStats } from "./types";

export function adaptPoi(): DomainStats {
  return { domain: "poi", hasData: false };
}
