/**
 * One printed address line split into street, postcode, city and country —
 * the comma-separated form portals and confirmations print:
 *
 *   "Zilverstraat 6, 2718 RL Zoetermeer, Niederlande"
 *   "Anhalter Str. 2, Friedrichshain-Kreuzberg, 10963 Berlin, Deutschland"
 *   "4949 Regent Boulevard, Irving, TX 75063, USA"
 *
 * Moved here from the Booking.com reader (plan 2026-10-09 P4b) so a template
 * of any issuer can split an address with the `address*` transforms. The
 * rules are about postal formats, not about a sender.
 *
 * The last segment is the country; the LAST segment that starts with a postal
 * code carries the city. Everything before it is the street (which may include
 * a district, as in the Berlin sample — preserved rather than dropped).
 */
import { splitPostcodeFromCity } from "../../../lodging/lodgingFieldNormalization";

export interface AddressParts {
  address: string | null;
  postcode: string | null;
  city: string | null;
  country: string | null;
}

const NONE: AddressParts = { address: null, postcode: null, city: null, country: null };

const orNull = (text: string): string | null => (text.length > 0 ? text : null);

/**
 * North America first, because its shape defeats the European one below.
 * "4949 Regent Boulevard, Irving, TX 75063, USA" has a HOUSE NUMBER of four
 * digits, which the European pattern reads as a postal code and the street
 * name as the city — measured on a real Courtyard confirmation, which
 * imported with the city "Regent Boulevard". A state or province code
 * followed by a ZIP is unambiguous, and the city is the segment before it.
 *
 * Only the LAST segment before the country counts, which is where that form
 * always puts it. Scanning for it anywhere would let a European address
 * whose middle segment happens to read "IT 00186" hand back the segment
 * before it as the city and drop the real one that follows.
 */
function northAmerican(rest: string[], country: string | null): AddressParts | null {
  const last = rest.length - 1;
  const m =
    last >= 1
      ? /^([A-Z]{2})\s+(\d{5}(?:-\d{4})?|[A-Z]\d[A-Z]\s?\d[A-Z]\d)$/.exec(rest[last])
      : null;
  if (!m) return null;
  return {
    address: orNull(rest.slice(0, last - 1).join(", ")),
    postcode: m[2],
    city: rest[last - 1],
    country,
  };
}

/** NL codes look like "2718 RL"; DE/AT/CH are 4-5 digits; CZ/SK/SE/GR write "767 01". */
function leadingPostcode(rest: string[], country: string | null): AddressParts | null {
  for (let i = rest.length - 1; i >= 0; i--) {
    const m = /^(\d{3}\s\d{2}|\d{4,5}(?:\s+[A-Z]{2})?)\s+(.+)$/.exec(rest[i]);
    if (m) {
      return { address: orNull(rest.slice(0, i).join(", ")), postcode: m[1], city: m[2], country };
    }
  }
  return null;
}

/**
 * Luxembourg (and the same shape elsewhere) writes the code as its OWN
 * segment, AFTER the city: "2, Rue Nicolas Wester, Luxemburg (Stadt), L-5836,
 * Luxemburg". Without this the code would be reported as the city. The spaced
 * CZ/SK form does the same: "…, Kroměříž, 767 01, Tschechische Republik".
 */
function bareCode(rest: string[], country: string | null): AddressParts | null {
  for (let i = rest.length - 1; i >= 1; i--) {
    if (!/^(?:(?:[A-Z]{1,2}-)?\d{4,5}|\d{3}\s\d{2})$/.test(rest[i])) continue;
    return {
      address: orNull(rest.slice(0, i - 1).join(", ")),
      postcode: rest[i],
      city: splitPostcodeFromCity(rest[i - 1]).city,
      country,
    };
  }
  return null;
}

export function splitAddressLine(raw: string | null): AddressParts {
  if (!raw) return NONE;
  const segments = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) return NONE;

  const country = segments.length > 1 ? segments[segments.length - 1] : null;
  const rest = country ? segments.slice(0, -1) : segments;
  const known =
    northAmerican(rest, country) ?? leadingPostcode(rest, country) ?? bareCode(rest, country);
  if (known) return known;

  // A plus-code or bare code in the city slot ("F869C3J") is not a city —
  // the UAE line put one there, and it became the stay's city.
  const codeShaped = /^(?=.*\d)[A-Z0-9+]{4,}$/;
  const cityRest =
    rest.length >= 2 && codeShaped.test(rest[rest.length - 1]) ? rest.slice(0, -1) : rest;

  // The last segment before the country is the city — but not always ONLY
  // the city: "188973 Singapur" and "BW 78467 Konstanz" (forgejo#85). The
  // shared splitter takes the code off and keeps it for the address.
  const split = splitPostcodeFromCity(cityRest[cityRest.length - 1] ?? null);
  return {
    address: cityRest.slice(0, -1).join(", ") || null,
    postcode: split.postcode,
    city: split.city,
    country,
  };
}
