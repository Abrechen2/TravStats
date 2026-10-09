import type { LocalDateValue, TimeValue } from "../shared/time";

/**
 * Shared trips, phases S1 and S2 — the wire shapes of `/api/v1/sharing`
 * (design `docs/superpowers/specs/2026-10-09-trip-sharing-design.md`).
 */

/** Another account as the sharing surfaces show it. */
export interface SharePerson {
  id: string;
  username: string;
  displayName: string;
}

export type ConsentStatus = "pending" | "accepted" | "declined" | "withdrawn";

export interface ShareConsent {
  id: string;
  status: ConsentStatus;
  createdAt: string;
  decidedAt: string | null;
  /** The other side of the pair. */
  person: SharePerson;
}

export interface ShareConsentList {
  incoming: ShareConsent[];
  outgoing: ShareConsent[];
}

export interface LinkableCompanion {
  id: string;
  name: string;
  linkedUser: SharePerson | null;
}

export interface LinkableCompanionList {
  companions: LinkableCompanion[];
  /** Accounts that accepted the caller's consent request. */
  linkableUsers: SharePerson[];
}

export interface ShareCandidate {
  companionId: string;
  name: string;
  user: SharePerson;
  consenting: boolean;
  shared: boolean;
}

/** Another member's booking total for their trip of the group, read-only (decision 2). */
export interface MemberBookingTotal {
  member: SharePerson;
  /** One sum per currency — never added across currencies. */
  totals: { currency: string; amount: number }[];
}

export interface TripSharing {
  groupId: string | null;
  members: SharePerson[];
  candidates: ShareCandidate[];
  bookingTotals: MemberBookingTotal[];
}

export interface ShareCounts {
  flights: number;
  lodgingStays: number;
  cruises: number;
  railJourneys: number;
  rentals: number;
  stops: number;
}

export interface ShareResult {
  groupId: string;
  tripCreated: boolean;
  created: ShareCounts;
}

export type ShareNoticeKind = "shared" | "created" | "updated" | "deleted" | "left";

/** The entry types a notice may name (S2); `trip` for shared/left. */
export type ShareEntityType =
  "trip" | "flight" | "lodgingStay" | "cruise" | "rail" | "rental" | "stop";

/**
 * One side of a changed fact, already in the API's time shapes (ADR 0002 D3):
 * the inbox formats it and computes no zone.
 */
export type ShareDisplayValue =
  | { kind: "time"; value: TimeValue }
  | { kind: "day"; value: LocalDateValue }
  | { kind: "wallClock"; value: string }
  | { kind: "text"; value: string }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "list"; count: number }
  | { kind: "empty" }
  | { kind: "other" };

export interface ShareNoticeChange {
  /** The fact's name; a house fact is `lodging.<name>`. */
  field: string;
  before: ShareDisplayValue;
  after: ShareDisplayValue;
}

export interface ShareNoticeAfter {
  /** `shared` / `left`: the trip's name. */
  tripName?: string;
  /** Entry notices: what the entry is ("TP571 FRA → LIS"). */
  label?: string;
  /** Entry notices: the reader's own trip and copy. */
  tripId?: string;
  entryId?: string;
  /** `deleted`: removed, or moved out of the shared trip. */
  reason?: "deleted" | "movedOut";
}

export interface ShareNotice {
  id: string;
  kind: ShareNoticeKind;
  entityType: ShareEntityType | null;
  /** For `trip`: the reader's own trip id; null for entry notices. */
  entityKey: string | null;
  after: ShareNoticeAfter | null;
  createdAt: string;
  readAt: string | null;
  /** When the reader undid this change. */
  undoneAt: string | null;
  actor: SharePerson | null;
  /** `updated`: every changed fact, old and new. */
  changes: ShareNoticeChange[];
}
