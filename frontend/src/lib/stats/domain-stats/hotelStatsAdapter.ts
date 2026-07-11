// Stub adapter for the lodging domain. Real implementation lands in a
// later phase when the lodging stats module ships. Returning
// hasData=false keeps the overview pipeline runnable without
// conditional branching.
import type { DomainStats } from "./types";

export function adaptHotel(): DomainStats {
  return { domain: "lodging", hasData: false };
}
