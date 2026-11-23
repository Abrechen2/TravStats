/**
 * Which operator ran a rail journey whose operator was never typed — from the
 * train category, the number and the countries / names of the two stations.
 * ONE rule table; `frontend/src/shared/railOperatorInference.ts` mirrors it
 * ("change both together"; each side's test asserts the same truth table).
 *
 * Abstention is a result: no category, an unknown one, or one that several
 * operators run (RE / RB, the regional trains — which company runs a line
 * depends on the region and the year) gives `null`, never a guess. A null
 * operator keeps the domain tile; a wrong logo would be worse than none.
 *
 * The names returned are catalogue names (`data/rail/operators.json`), so the
 * logo lookup finds them.
 */

export interface RailInferenceInput {
  trainCategory?: string | null;
  trainNumber?: string | null;
  depCountry?: string | null;
  arrCountry?: string | null;
  depStationName?: string | null;
  arrStationName?: string | null;
}

export const INFERRED_FERNVERKEHR = "DB Fernverkehr";
export const INFERRED_SBAHN_MUENCHEN = "S-Bahn München";
export const INFERRED_MERIDIAN = "Meridian";

/** The `operatorSource` value of a stored inference. */
export const OPERATOR_SOURCE_INFERRED = "inferred";

const normCategory = (value: string | null | undefined): string =>
  (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const country = (value: string | null | undefined): string | null =>
  value ? value.trim().toUpperCase() : null;

/** Both ends in Germany; an unknown country passes only when the other end is German. */
function bothGerman(input: RailInferenceInput): boolean {
  const dep = country(input.depCountry);
  const arr = country(input.arrCountry);
  if (dep === null && arr === null) return false;
  return (dep === null || dep === "DE") && (arr === null || arr === "DE");
}

function anyGerman(input: RailInferenceInput): boolean {
  return country(input.depCountry) === "DE" || country(input.arrCountry) === "DE";
}

const MUNICH = /m(ü|ue|u)nchen|munich/i;

/** The operator the evidence names, or null when it does not name one. */
export function inferRailOperator(input: RailInferenceInput): string | null {
  const category = normCategory(input.trainCategory);
  if (!category) return null;
  const number = (input.trainNumber ?? "").replace(/\s+/g, "");
  switch (category) {
    case "ICE":
      // DB's own brand; it also runs into NL, BE, FR, AT, CH, so one German end is enough.
      return anyGerman(input) ? INFERRED_FERNVERKEHR : null;
    case "IC":
    case "EC":
    case "ECE":
      // Abroad IC / EC are other companies' trains (ÖBB, SBB, PKP …).
      return bothGerman(input) ? INFERRED_FERNVERKEHR : null;
    case "S":
      return bothGerman(input) &&
        (MUNICH.test(input.depStationName ?? "") || MUNICH.test(input.arrStationName ?? ""))
        ? INFERRED_SBAHN_MUENCHEN
        : null;
    case "M":
      // Meridian's numbers are 79xxx; a bare "M" on another number is not proof.
      return bothGerman(input) && /^79\d{3}$/.test(number) ? INFERRED_MERIDIAN : null;
    default:
      return null;
  }
}
