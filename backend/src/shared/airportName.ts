/**
 * Cleaning the airport names OurAirports ships.
 *
 * The upstream CSV marks rows its editors suspect of being duplicates by
 * writing the marker INTO the name column — `[Duplicate] Beijing Xijiao
 * Airport`, `(Duplicate)Yeouido Airport`, `Sayma (duplicate)`. It is not a
 * handful of rows and not a one-off: the file downloaded on 2026-08-29 carried
 * 132 of them, in at least six bracket shapes, some malformed (`(Duplicate}`),
 * some hedged (`(Misplaced duplicate?)`).
 *
 * The seeder wrote `name` through verbatim, so those markers reached the
 * airport picker as if they were part of the airport's name.
 *
 * Dropping the rows instead is NOT an option: for the ones that matter the
 * marked row is the only one carrying that IATA code, so discarding it removes
 * the code from the catalogue entirely.
 *
 * This lives in `shared/` because the catalogue has TWO write paths — the CLI
 * seed script and the admin re-seed service — and the last rule written into
 * only one of them shipped wrong in three release candidates. Both import from
 * here; neither may keep a copy.
 */

/**
 * A bracketed group whose contents mention "duplicate".
 *
 * Matching on the WORD rather than on one literal shape is what catches the
 * malformed variants; requiring the brackets is what protects legitimate
 * parentheticals like `Halifax (South Battery) Heliport`. Opening and closing
 * brackets deliberately need not match each other — the source contains
 * `(Duplicate}`.
 *
 * Kept as a string because the same pattern has to reach Postgres, which does
 * the one job JavaScript cannot: repairing rows already in the table.
 */
export const DUPLICATE_MARKER_PATTERN = String.raw`[([{][^)\]}]*duplicate[^)\]}]*[)\]}]`;

const WHITESPACE_RUN = String.raw`\s+`;

const DUPLICATE_MARKER = new RegExp(DUPLICATE_MARKER_PATTERN, 'gi');

/**
 * The catalogue name for a CSV row.
 *
 * Returns the original when stripping would leave nothing behind — a row named
 * only by its marker still needs some name, and an empty entry in the picker is
 * worse than an ugly one.
 */
export function normalizeAirportName(rawName: string): string {
  const stripped = rawName.replace(DUPLICATE_MARKER, ' ').replace(/\s+/g, ' ').trim();
  return stripped.length > 0 ? stripped : rawName.trim();
}

/**
 * The same rule as one SQL statement, for repairing rows already in the table.
 *
 * The import fix alone does NOT clean the catalogue. A marked row whose CSV
 * counterpart has since been renamed or retyped upstream is an orphan no
 * re-seed ever matches again — and those orphans are precisely the ones with
 * real IATA codes in the picker (VLO Vlora, WFR Wolf's Fang). Wolf's Fang is
 * today `AQ-0011 small_airport` with no code at all upstream, so the admission
 * rule rightly refuses to re-admit it; the row we already hold is the only
 * place that code survives, and it must be repaired rather than replaced.
 *
 * Built from `DUPLICATE_MARKER_PATTERN` so the two cannot drift apart — a test
 * pins the migration's text to this output, so changing the rule breaks it.
 *
 * The `<> ''` condition is the SQL half of the same guard the function makes:
 * a row named only by its marker keeps the ugly name rather than losing it.
 */
export function buildDuplicateMarkerCleanupSql(table: string, column: string): string {
  const cleaned = `btrim(regexp_replace(regexp_replace("${column}", '${DUPLICATE_MARKER_PATTERN}', ' ', 'gi'), '${WHITESPACE_RUN}', ' ', 'g'))`;
  return [
    `UPDATE "${table}"`,
    `SET "${column}" = ${cleaned}`,
    `WHERE "${column}" ~* '${DUPLICATE_MARKER_PATTERN}'`,
    `  AND ${cleaned} <> '';`,
  ].join('\n');
}
