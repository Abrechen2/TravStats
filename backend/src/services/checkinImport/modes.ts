/** Source categories -> the domain a ride is imported into. */

import type { CheckinMode } from "./types";

/** Träwelling's HAFAS categories. */
const TRAEWELLING: Record<string, CheckinMode | { unsupported: string }> = {
  nationalexpress: "rail",
  national: "rail",
  regionalexp: "rail",
  regionalexpress: "rail",
  regional: "rail",
  suburban: "rail",
  subway: "metro",
  tram: "tram",
  bus: "bus",
  ferry: { unsupported: "ferry" },
  taxi: { unsupported: "taxi" },
  plane: { unsupported: "plane" },
};

export function modeFromTraewellingCategory(
  raw: string | undefined
): CheckinMode | { unsupported: string } {
  const key = (raw ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (key === "") return "rail";
  return TRAEWELLING[key] ?? { unsupported: key };
}

/** travelynx prints the train type as DB does: ICE, RE, S, U, STR, Bus. */
export function modeFromTrainType(raw: string | undefined): CheckinMode | { unsupported: string } {
  const key = (raw ?? "").trim().toLowerCase();
  if (key === "u" || key === "ubahn" || key === "u-bahn") return "metro";
  if (key === "str" || key === "tram" || key === "strab") return "tram";
  if (key === "bus" || key === "ice-bus") return "bus";
  if (key === "fähre" || key === "faehre" || key === "schiff") return { unsupported: "ferry" };
  return "rail";
}
