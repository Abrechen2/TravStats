import { foldCountryEvidence } from "../../shared/countryEvidence";

/**
 * Country text -> ISO 3166-1 alpha-2, decided by the counting rule itself.
 *
 * This asks `shared/countryEvidence.ts` rather than calling the two underlying
 * resolvers again. That matters more here than it looks: a flag that named a
 * country the passport does not count — or missed one it does — would be a
 * second opinion about what a country IS, and the whole point of that module is
 * that there is only one. So the question is put TO the rule, not re-derived
 * beside it.
 *
 * `kind` and `tier` are inert for this question. `foldCountryEvidence` needs
 * them to fold, and the only field read back is `code`.
 */
export function resolveEvidenceCountry(text: string | null | undefined): string | null {
  if (!text) return null;
  const folded = foldCountryEvidence([{ country: text, kind: "lodging", tier: "visited" }]);
  return folded.length > 0 ? folded[0].code : null;
}
