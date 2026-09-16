import { toCountryCode } from '../../shared/countryEvidence';

/**
 * The key everything GROUPS or COUNTS on — never the free text.
 *
 * `schema.prisma` states this at `Lodging.isoCountryCode`: the text
 * field keeps whatever the source wrote ("Deutschland", "Germany",
 * "Schweiz/Suisse/Svizzera/Svizra"); grouping joins on the code. The
 * write paths obeyed it, this one did not, and the statistics page
 * listed "Deutschland" and "Germany" as two countries with the nights
 * and money split between them.
 *
 * The stored column wins. When it is empty the text is resolved on the
 * fly — through `shared/countryEvidence.ts`, the one home for that join,
 * rather than through one of the two resolvers behind it: a bucket keyed
 * differently here than the passport counts is a second opinion about
 * what a country is. When nothing resolves, the text survives as its own
 * key: "Dubai" is a city, and a row that names no country is a finding
 * worth seeing, not one to drop.
 *
 * It also repairs the continents: `continentForCountry` understands ISO
 * codes and English names, so German text used to fall through to the
 * deliberately coarse coordinate guess — and a house without
 * coordinates lost its continent altogether.
 */
export function lodgingCountryKey(l: { country: string | null; isoCountryCode: string | null }): string | null {
  return l.isoCountryCode ?? toCountryCode(l.country) ?? l.country;
}
