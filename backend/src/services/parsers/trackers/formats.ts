/**
 * The other flight trackers whose exports TravStats reads (forgejo#311).
 *
 * The ids double as the `source` of a preview row and, prefixed with
 * `imported_`, as a flight's `dataSource` — so the provenance of every
 * imported flight names the app it came from. Mirrored in
 * `frontend/src/lib/importers/types.ts`; change both together.
 */
export const TRACKER_FORMATS = [
  "openflights",
  "airtrail",
  "jetlog",
  "flighty",
  "app_in_the_air",
] as const;

export type TrackerFormat = (typeof TRACKER_FORMATS)[number];

/** `dataSource` values of flights imported from a tracker export. */
export const TRACKER_DATA_SOURCES = [
  "imported_openflights",
  "imported_airtrail",
  "imported_jetlog",
  "imported_flighty",
  "imported_app_in_the_air",
] as const satisfies readonly `imported_${TrackerFormat}`[];

/**
 * What each format is recognised by, as it appears in the file. Sent back
 * with an "unknown format" error so the user (and an API client) learns what
 * the importer looked for instead of a bare refusal.
 */
export const TRACKER_SIGNATURES: Record<TrackerFormat, readonly string[]> = {
  openflights: ["Date", "From", "To", "Flight_Number", "Airline", "Duration", "From_OID"],
  airtrail: ['JSON: { "users": [...], "flights": [{ "date", "from", "to", "departure" }] }'],
  jetlog: ["date", "origin", "destination", "departure_time", "arrival_time", "ticket_class"],
  flighty: ["Date", "Airline", "Flight", "From", "To", "Gate Departure (Scheduled)", "Canceled"],
  app_in_the_air: ["trips:", "Ownership.MINE;…", "flights:", "hotels:"],
};
