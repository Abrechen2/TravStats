// Stub adapter for the hotel domain. Real implementation lands in V2.X
// when the hotel module ships. Returning hasData=false keeps the
// overview pipeline runnable without conditional branching.
import type { DomainStats } from "./types";

export function adaptHotel(): DomainStats {
  return { domain: "hotel", hasData: false };
}
