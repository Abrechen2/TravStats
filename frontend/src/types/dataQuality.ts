/**
 * The data-quality inbox, as the frontend reads it.
 *
 * Mirrors `backend/src/schemas/dataQualityFlag.ts` — change both together.
 *
 * The wording rule that governs every string rendered from these types:
 * **a flag is a question, not a verdict.** Both sides of a disagreement travel
 * in `details` and NEITHER is marked correct. A third-party geocoder does not
 * get a veto over the user's own data, so no component may render one value as
 * "right" and the other as "wrong" — no strikethrough, no green/red pair, no
 * "correct to" arrow. That is the diff vocabulary of `PendingUpdateCard`, and
 * borrowing it here would answer a question the user is being asked.
 */

/**
 * What a flag is about. `country` is not a row — the ISO code is the subject.
 * The last four arrived with the time-model migration (ADR 0002, plan Phase
 * 3b): a time value the migration could not convert is flagged on its row.
 */
export type DataQualityEntityType =
  "lodging" | "place" | "country" | "flight" | "cruise_stop" | "trip_stop" | "place_visit";

/** Which check fired. */
export type DataQualityFlagKind =
  | "address_country_mismatch"
  | "undated_country_evidence"
  | "stay_dates_reversed"
  | "coordinates_outside_country"
  | "time_zone_unresolved"
  | "time_precision_unknown";

/**
 * `resolved` and `dismissed` are NOT two spellings of "done" — the UI must keep
 * them apart in words, not only in the endpoint it calls. See
 * `DataQualityFlagCard` for how the two buttons are worded and why.
 */
export type DataQualityFlagStatus = "open" | "resolved" | "dismissed";

/**
 * A ROW a flag points at, in the shape the UI needs to link to it.
 *
 * Narrower than `DataQualityEntityType` on purpose: `label` is display text the
 * user wrote, and a country has none — its name is localised here, in the
 * browser, from `DataQualityFlagSubject`'s `countryCode`. Keeping the country
 * out of this shape is what stops `label` from meaning a name in one place and
 * an ISO code in another.
 */
export interface FlaggedRecord {
  entityType: "lodging" | "place";
  entityId: string;
  /** What to call it on screen. The user's own text, never a code. */
  label: string;
}

/**
 * What a flag is about — a row with a name, or a country with a code.
 *
 * Two shapes rather than one field that means two things. The server cannot
 * produce a country's NAME (it does not know the reader's language), so it sends
 * the code and this side localises it; a row's name it can and does send ready
 * to print. Reading `label` off a subject therefore always yields display text,
 * and a country has no `label` to read by mistake.
 */
export type DataQualityFlagSubject =
  FlaggedRecord | TimeValueRecord | { entityType: "country"; countryCode: string };

/**
 * The row a time flag is about. Kept apart from `FlaggedRecord` because it is
 * reached differently: a stop or a visit is edited through its parent record,
 * whose id travels in the flag's `details.parentId` — see `timeFlagLinks.ts`.
 */
export interface TimeValueRecord {
  entityType: "flight" | "cruise_stop" | "trip_stop" | "place_visit";
  entityId: string;
  /** What to call it on screen. The user's own text, never a code. */
  label: string;
}

/** What the geocoder said against what the address says. */
export interface AddressCountryMismatchDetails {
  claimedCountryCode: string | null;
  claimedCountryText: string | null;
  addressCountryCode: string;
  addressCountryText: string;
  address: string;
}

/** Which country, and every record that names it — all of them undated. */
export interface UndatedCountryEvidenceDetails {
  countryCode: string;
  records: FlaggedRecord[];
}

/** The offending stays of one lodging, with both dates as stored. */
export interface StayDatesReversedDetails {
  stays: { stayId: string; checkIn: string; checkOut: string }[];
}

/**
 * Where the record says it is, against where its coordinates fall.
 *
 * Both codes are present and neither is marked correct, like every other flag.
 * `lat`/`lon` are here so the card can show the point that was tested: a
 * coordinate two degrees out is a typo the user recognises at a glance, and one
 * that is right means the country is the field to fix.
 */
export interface CoordinatesOutsideCountryDetails {
  claimedCountryCode: string;
  coordinateCountryCode: string;
  lat: number;
  lon: number;
}

/**
 * A time value the migration left as it was (ADR 0002, plan Phase 3b).
 *
 * Shared by both time kinds: `time_zone_unresolved` (no zone could be found,
 * so nothing was converted) and `time_precision_unknown` (the day is kept,
 * the time of day is not known). Not a disagreement between two values — a
 * gap only the user can fill, which is why the card sends them to the editor.
 *
 * PROVISIONAL: shaped from the plan while the backend half was being built;
 * the backend's `schemas/dataQualityFlag.ts` is the contract once it lands.
 */
export interface TimeValueFlagDetails {
  /** Which value on the row (`departure`, `visitedAt`, …). */
  field: string;
  /** Why the migration stopped (`no_zone`, `writer_unknown`, …). */
  reason: string;
  /** The record the row is edited through — cruise, trip or place. */
  parentId: string | null;
  /** The calendar day that was kept, `YYYY-MM-DD`; null if none is known. */
  localDay: string | null;
}

/** Every detail shape, as a union. Only useful where `kind` is already known. */
export type DataQualityFlagDetails =
  | AddressCountryMismatchDetails
  | UndatedCountryEvidenceDetails
  | StayDatesReversedDetails
  | CoordinatesOutsideCountryDetails
  | TimeValueFlagDetails;

/**
 * Everything a flag carries that does not depend on its `kind`.
 *
 * `subject` is optional here although the server always sends it. The server
 * drops a flag whose subject no longer exists rather than shipping a dead
 * entry — but the client does not enforce that, and a page that throws on a
 * missing name would turn a server-side edge case into a blank inbox. The type
 * says what the client is prepared for, not what the server currently promises.
 */
interface DataQualityFlagBase {
  id: string;
  entityType: DataQualityEntityType;
  entityId: string;
  status: DataQualityFlagStatus;
  subject?: DataQualityFlagSubject | null;
  createdAt: string;
  resolvedAt: string | null;
}

/**
 * One flag as the API returns it, with `kind` and `details` tied together.
 *
 * They are two columns on the server and two fields on the wire, and until
 * 2026-09-02 nothing joined them: `details` was validated as SOME known shape,
 * never as the shape `kind` names. Reading one off the other therefore needed
 * three hand-written runtime guards here, and each card fell back to a neutral
 * "cannot be shown" line whenever a guard said no.
 *
 * The server now parses `{kind, details}` through a discriminated union before
 * it answers (`schemas/dataQualityFlag.ts` → `flagService.toView`), so a row
 * whose two columns disagree is never served at all. The guards are gone;
 * switching on `kind` and reading `details` is a promise the payload makes.
 *
 * What this still cannot promise is that `kind` is one this build knows — a
 * server running a newer check is a real thing — so `FlagContradiction` keeps
 * one fallback for an unrecognised kind, and only that one.
 */
export type DataQualityFlag =
  | (DataQualityFlagBase & {
      kind: "address_country_mismatch";
      details: AddressCountryMismatchDetails;
    })
  | (DataQualityFlagBase & {
      kind: "undated_country_evidence";
      details: UndatedCountryEvidenceDetails;
    })
  | (DataQualityFlagBase & { kind: "stay_dates_reversed"; details: StayDatesReversedDetails })
  | (DataQualityFlagBase & {
      kind: "coordinates_outside_country";
      details: CoordinatesOutsideCountryDetails;
    })
  | (DataQualityFlagBase & {
      kind: "time_zone_unresolved" | "time_precision_unknown";
      details: TimeValueFlagDetails;
    });

/** What `POST /data-quality-flags/run` answers. */
export interface DataQualityRunSummary {
  opened: number;
  reopened: number;
  updated: number;
  autoResolved: number;
  /** Open flags after the run. What the inbox will show. */
  open: number;
}
