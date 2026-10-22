/**
 * Why an uploaded flight track file gave no track (forgejo#312) — raised
 * through `refusalError()` in `services/flightDevice/flightTrackFile.ts`, one
 * code per reason so the UI can say which. Part of `ApiErrorCode`
 * (`errorHandler.ts`), kept here because that file sits at its size limit; the
 * frontend maps each to DE/EN copy (`FLIGHT_TRACK_ERROR_KEYS`). The tour's
 * `TRACK_FILE_UNREADABLE` doubles as the GPX/TCX/FIT case here.
 */
export type FlightTrackFileApiErrorCode =
  /** None of the accepted formats, by bytes or by name. */
  | "TRACK_FILE_UNSUPPORTED"
  /** KML that is not well-formed XML. */
  | "TRACK_KML_INVALID"
  /** A `gx:Track` with a different number of `<when>`s than `<gx:coord>`s. */
  | "TRACK_KML_UNPAIRED"
  /** KML without two positions to draw — e.g. only the two airports. */
  | "TRACK_KML_NO_TRACK"
  /** A ZIP (KMZ) that is cut short or corrupt. */
  | "TRACK_KMZ_DAMAGED"
  /** A ZIP that holds no `.kml` entry. */
  | "TRACK_KMZ_NO_KML"
  /** The KML inside the KMZ is over the upload limit once unpacked. */
  | "TRACK_KMZ_TOO_LARGE"
  /** A CSV without Flightradar24's Timestamp/UTC and Position columns. */
  | "TRACK_CSV_COLUMNS"
  /** Flightradar24 CSV with fewer than two rows carrying a time and a position. */
  | "TRACK_CSV_NO_POSITIONS";
