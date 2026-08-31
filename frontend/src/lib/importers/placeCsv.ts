// POI CSV importer: field spec, German-first aliases and the candidate builder.
//
// Mirrors `lodgingCsv.ts` — same shape, same mapping wizard, same "pure module"
// rule: no network, no React, no i18n strings (labels are injected by the
// caller through `buildPlaceMappingFields`).
//
// POI Phase D §5. The point of the CSV path is that it needs NO geocoding when
// the file carries `lat`/`lon`, which is also the escape hatch for a Google
// Takeout export the geocoder cannot resolve: export it, fill the coordinates
// in, import it again. A row that still has none is not rejected here — the
// preview offers it back to the user, who knows where the place is.

import type { MappingFieldSpec } from "../../components/import/ColumnMappingWizard";
import type { PlaceImportCandidate } from "../../types/placeImport";

export const PLACE_CSV_FIELDS = [
  "name",
  "lat",
  "lon",
  "category",
  "address",
  "city",
  "country",
  "notes",
  "visitedAt",
  "externalRef",
] as const;

export type PlaceCsvField = (typeof PLACE_CSV_FIELDS)[number];
export type PlaceCsvMapping = Partial<Record<PlaceCsvField, string>>;

/**
 * German first, for the same reason `LODGING_FIELD_ALIASES` is: the files people
 * actually bring are German exports.
 *
 * Compared by `autoMapHeaders` lower-cased with non-alphanumerics stripped. An
 * umlaut is STRIPPED rather than transliterated there, so "Längengrad" and
 * "Laengengrad" normalise to different strings and both need their own entry —
 * the lodging list learned that the hard way and this one inherits the lesson.
 */
export const PLACE_FIELD_ALIASES: Record<PlaceCsvField, string[]> = {
  name: ["name", "ort", "titel", "title", "place", "bezeichnung", "poi"],
  lat: ["lat", "latitude", "breitengrad", "breite"],
  lon: ["lon", "lng", "long", "longitude", "laengengrad", "längengrad", "laenge", "länge"],
  category: ["category", "kategorie", "art", "typ", "type"],
  address: ["address", "adresse", "strasse", "straße", "street"],
  city: ["city", "stadt", "town"],
  country: ["country", "land", "staat"],
  // A Google Takeout "Saved" export puts the user's own words in a note column;
  // it is the one field in such a file that nothing else could reconstruct.
  notes: ["notes", "notiz", "notizen", "bemerkung", "kommentar", "comment", "beschreibung"],
  visitedAt: ["visitedat", "besuchtam", "besucht", "datum", "date", "visited"],
  // Same reasoning as lodging's `googlePlaceId`: a Takeout export has no id
  // column, the identity sits inside the Maps link.
  externalRef: ["externalref", "id", "ref", "referenz", "url", "link", "maps", "googlemaps", "cid"],
};

/** `name` is the only required column — it is all a row needs to be offered. */
const REQUIRED_FIELDS: PlaceCsvField[] = ["name"];

export function buildPlaceMappingFields(
  label: (field: PlaceCsvField) => string
): MappingFieldSpec<PlaceCsvField>[] {
  return PLACE_CSV_FIELDS.map((field) => ({
    key: field,
    label: label(field),
    required: REQUIRED_FIELDS.includes(field),
    aliases: PLACE_FIELD_ALIASES[field],
  }));
}

/**
 * A decimal that may be written the German way.
 *
 * "48,137" and "48.137" are the same latitude to a person and different numbers
 * to `Number()`. Returning null rather than a wrong number matters more here
 * than anywhere else in this file: a misread coordinate does not look broken,
 * it looks like a place somewhere else entirely.
 */
function readCoordinate(raw: string | undefined): number | null {
  const text = raw?.trim();
  if (!text) return null;
  // Only treat a comma as a decimal separator when there is no dot — "1.234,5"
  // is one number and "1,234.5" is another, and guessing between them would be
  // the same wrong-number risk this function exists to avoid.
  const normalized = text.includes(".") ? text.replace(/,/g, "") : text.replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

const readText = (raw: string | undefined): string | null => {
  const text = raw?.trim();
  return text ? text : null;
};

export interface PlaceCsvRowError {
  sourceRowIndex: number;
  code: "missing_name";
}

export interface PlaceCsvBuildResult {
  candidates: PlaceImportCandidate[];
  errors: PlaceCsvRowError[];
}

/**
 * Turn mapped CSV rows into candidates for `POST /place-import/preview`.
 *
 * Only a row with no name is rejected: without one there is nothing to show the
 * user and nothing to decide about. Everything else — including a row with no
 * coordinates at all, which is every row of a Google Takeout export — goes
 * through, because deciding its fate is the preview's job and ultimately the
 * user's.
 */
export function buildPlaceCandidates(
  rows: readonly Record<string, string>[],
  mapping: PlaceCsvMapping
): PlaceCsvBuildResult {
  const candidates: PlaceImportCandidate[] = [];
  const errors: PlaceCsvRowError[] = [];

  rows.forEach((row, index) => {
    const cell = (field: PlaceCsvField): string | undefined => {
      const column = mapping[field];
      return column ? row[column] : undefined;
    };

    const name = readText(cell("name"));
    if (!name) {
      errors.push({ sourceRowIndex: index, code: "missing_name" });
      return;
    }

    const lat = readCoordinate(cell("lat"));
    const lon = readCoordinate(cell("lon"));

    candidates.push({
      sourceRowIndex: index,
      name,
      // A half-position is no position. One coordinate without the other cannot
      // place anything, and carrying it forward would only make the row look
      // more complete than it is.
      lat: lat !== null && lon !== null ? lat : null,
      lon: lat !== null && lon !== null ? lon : null,
      category: readText(cell("category")),
      address: readText(cell("address")),
      city: readText(cell("city")),
      country: readText(cell("country")),
      notes: readText(cell("notes")),
      visitedAt: readText(cell("visitedAt")),
      externalRef: readText(cell("externalRef")),
    });
  });

  return { candidates, errors };
}
