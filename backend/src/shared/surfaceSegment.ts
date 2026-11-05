/**
 * "Is this booking line really a flight?" — the one answer for ground
 * segments sold inside a flight booking (Lufthansa Express Rail / Express Bus,
 * AIRail, a rail-and-fly coupon): they carry a flight number and a pair of
 * three-letter codes, so a flight reader reads them as flights, and a flight
 * that is a train then counts in flight kilometres, flight CO2 and the
 * passport's airports — a wrong number nobody sees.
 *
 * Owner ruling 2026-11-05: such a segment is a rail ride or a bus ride (the
 * flight number stays as the marketing code), not a flight.
 *
 * Detection is generic on purpose (owner rule: only generic parsers in the
 * server). It reads what any booking says about itself and names no carrier:
 *
 * - equipment: the IATA equipment code or text of the "aircraft" column —
 *   `TRN` (train), `ICE` (high-speed train), `BUS`, `RFS` (road feeder
 *   service) — or the words train / coach;
 * - operator: the operating carrier or the product name says rail ("Deutsche
 *   Bahn", "DB", "Express Rail") or bus ("Express Bus", "Busreisen");
 * - station: an endpoint that is not an airport. This one only CORROBORATES —
 *   an unknown code is just as often an airport the catalogue lacks, so it can
 *   never turn a flight into a train on its own (abstention is a result).
 *
 * Equipment outranks the operator when they disagree.
 */

export type SurfaceMode = "rail" | "bus";
export type SurfaceSignal = "equipment" | "operator" | "station";

export interface SurfaceSegmentInput {
  /** The equipment column: "TRN", "BUS", "Airbus A321" … */
  aircraft?: string | null;
  airline?: string | null;
  operatingAirline?: string | null;
  /** true / false when the airport catalogue was asked; null or absent = not asked. */
  departureIsAirport?: boolean | null;
  arrivalIsAirport?: boolean | null;
}

export interface SurfaceVerdict {
  mode: SurfaceMode;
  signals: SurfaceSignal[];
}

const EQUIPMENT_RAIL = /\b(TRN|TRAIN|RAIL|RAILWAY|ICE|ZUG)\b/i;
const EQUIPMENT_BUS = /\b(BUS|COACH|MOTORCOACH|RFS)\b/i;

/** `\b` does not work for "ö", so the Austrian railway is spelled around it. */
const OPERATOR_RAIL =
  /(\b(deutsche\s+bahn|bahn|rail|railway|railways|train|db)\b|\böbb\b|\boebb\b|\bsncf\b|\bsbb\b|\btrenitalia\b)/i;
const OPERATOR_BUS = /\b(bus|busse|busreisen|coach|omnibus)\b/i;

const modeOfText = (text: string, rail: RegExp, bus: RegExp): SurfaceMode | null => {
  // Bus first: "Express Bus Rail Link" is rare, but "Rail" in a bus line's
  // brand ("Rail&Bus") must not make a coach a train.
  if (bus.test(text) && !rail.test(text)) return "bus";
  if (rail.test(text) && !bus.test(text)) return "rail";
  return null;
};

export function classifySurfaceSegment(input: SurfaceSegmentInput): SurfaceVerdict | null {
  const equipment = input.aircraft?.trim() ?? "";
  const operatorText = [input.operatingAirline, input.airline]
    .map((s) => s?.trim() ?? "")
    .filter(Boolean)
    .join(" | ");

  const equipmentMode = equipment ? modeOfText(equipment, EQUIPMENT_RAIL, EQUIPMENT_BUS) : null;
  const operatorMode = operatorText ? modeOfText(operatorText, OPERATOR_RAIL, OPERATOR_BUS) : null;

  const mode = equipmentMode ?? operatorMode;
  if (!mode) return null;

  const signals: SurfaceSignal[] = [];
  if (equipmentMode) signals.push("equipment");
  if (operatorMode && operatorMode === mode) signals.push("operator");
  if (input.departureIsAirport === false || input.arrivalIsAirport === false) {
    signals.push("station");
  }
  return { mode, signals };
}
