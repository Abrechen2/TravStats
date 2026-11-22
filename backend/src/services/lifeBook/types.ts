export type BookLang = "de" | "en";

export type EntryKind =
  "flight" | "rail" | "bus" | "ferry" | "rental" | "cruise" | "stay" | "visit" | "journal";

export type DocKind = "invoice" | "booking" | "boardingPass" | "ticket" | "other";

export interface BookPhoto {
  /** `data:` URI, already downscaled. */
  dataUri: string;
  caption: string | null;
  /** Local day (`YYYY-MM-DD`) the picture was taken, null when unknown. */
  takenDay: string | null;
}

export interface BookEntry {
  kind: EntryKind;
  /** Local calendar day, `YYYY-MM-DD`. Null = the date is unknown (never guessed). */
  day: string | null;
  /** Local `HH:MM` when the entry's zone is known, else null. */
  time: string | null;
  /** The known part of an otherwise unknown date: `YYYY` or `YYYY-MM`. Null = nothing known, or `day` is set. */
  partial?: string | null;
  /** Instant used only to order entries inside a day; null sorts after dated ones. */
  sortMs: number | null;
  /** The last day of a multi-day entry (stay, cruise, rental), when known. */
  endDay: string | null;
  title: string;
  detail: string[];
  notes: string | null;
  evidence: DocKind[];
  photos: BookPhoto[];
  /** Stable tiebreak so two builds of the same data are byte-identical. */
  id: string;
}

export interface MapPoint {
  lat: number;
  lon: number;
  label: string;
}

export interface BookTrip {
  id: string;
  name: string;
  startDay: string | null;
  endDay: string | null;
  /** ISO alpha-2 codes where known, otherwise the stored name. */
  countries: string[];
  travellers: string[];
  description: string | null;
  notes: string | null;
  evidence: DocKind[];
  entries: BookEntry[];
  photos: BookPhoto[];
  points: MapPoint[];
  legs: Array<[MapPoint, MapPoint]>;
}

export interface BookFrame {
  lang: BookLang;
  /** `YYYY-MM-DD` the book was generated on (passed in, so a build is reproducible). */
  generatedOn: string;
  username: string;
  scopeTitle: string;
}
