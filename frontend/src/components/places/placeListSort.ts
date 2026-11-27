import type { PlaceColumnId, PlaceSortKey } from "./PlaceRow";
import { continentLabel } from "../../lib/continentLabel";
import { placeCountryLabel } from "../../lib/placeCountry";
import type { Place } from "../../types/place";

export const SORT_KEY_BY_COLUMN: Partial<Record<PlaceColumnId, PlaceSortKey>> = {
  name: "name",
  category: "category",
  location: "location",
  country: "country",
  continent: "continent",
  visits: "visits",
  lastVisit: "lastVisit",
};

export type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The country as a reader sees it — localised from the ISO code, falling back
 *  to whatever text the source wrote. */

/** One label source for header, picker, aria and footer — they must agree. */
export function columnLabel(t: Translate, id: PlaceColumnId): string {
  return t(`places:list.columns.${id}`);
}

/** Sort keys that read most naturally descending first — the same convention
 *  the lodging list uses for its count columns. */
export const SORT_DEFAULT_ASC: Record<PlaceSortKey, boolean> = {
  name: true,
  category: true,
  location: true,
  country: true,
  continent: true,
  visits: false,
  lastVisit: false,
};

export function compareRows(
  a: Place,
  b: Place,
  key: PlaceSortKey,
  locale: string,
  t: Translate
): number {
  switch (key) {
    case "category":
      return a.category.localeCompare(b.category);
    case "location":
      return (a.city ?? "").localeCompare(b.city ?? "", locale);
    // Country and continent sort on the LOCALISED label, not the raw code: a
    // German reader expects Ägypten by Ä, and "EG" would file it under E.
    case "country":
      return placeCountryLabel(a, locale).localeCompare(placeCountryLabel(b, locale), locale);
    case "continent":
      return continentLabel(a.continent, t, "").localeCompare(
        continentLabel(b.continent, t, ""),
        locale
      );
    case "visits":
      return a.visitCount - b.visitCount;
    case "lastVisit": {
      // Undated-but-visited places sort to the END either way rather than
      // pretending to be the oldest — a missing date is not a date.
      const av = a.lastVisitAt ? Date.parse(a.lastVisitAt) : Number.NEGATIVE_INFINITY;
      const bv = b.lastVisitAt ? Date.parse(b.lastVisitAt) : Number.NEGATIVE_INFINITY;
      return av - bv;
    }
    default:
      return a.name.localeCompare(b.name, locale);
  }
}
