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

/** Another member's booking total for their trip of the group, read-only (decision 2). */
export interface MemberBookingTotal {
  member: SharePerson;
  /** One sum per currency — never added across currencies. */
  totals: { currency: string; amount: number }[];
}

/**
 * The ONE reason sharing a trip with a person is not possible yet. The
 * server decides it (`accountInactive` is added by the controller's person
 * list), so the page never draws an action the server would refuse.
 */
export type ShareBlock =
  | "notLinked"
  | "consentMissing"
  | "consentPending"
  | "groupConsentMissing"
  | "alreadyMember"
  | "accountInactive";

/** One person of a trip: a companion, or a group member who is none. */
export interface TripPerson {
  /** "c:<companionId>" for a companion, "u:<userId>" for a member who is none. */
  key: string;
  companionId: string | null;
  name: string;
  account: SharePerson | null;
  /** The caller's request to `account`; "none" when there is no row. */
  consent: "none" | ConsentStatus;
  member: boolean;
  /** Members only: an accepted consent in either direction lets changes through. */
  receivesChanges: boolean | null;
  shareBlockedBy: ShareBlock | null;
  /**
   * A member who is none of the reader's companions: the reader's unlinked companions whose
   * name may be theirs ("Ist das <Name>?"). Optional: an older server sends none.
   */
  nameMatches?: { id: string; name: string; onTrip: boolean }[];
  /** A companion linked to a person on another server: listed in that section only. */
  remoteLinked?: boolean;
}

export interface TripSharing {
  groupId: string | null;
  people: TripPerson[];
  /** Accounts that accepted the caller's consent request. */
  linkableUsers: SharePerson[];
  bookingTotals: MemberBookingTotal[];
}

export interface ShareCounts {
  flights: number;
  lodgingStays: number;
  cruises: number;
  railJourneys: number;
  busJourneys: number;
  ferryJourneys: number;
  rentals: number;
  roadtrips: number;
  tours: number;
  stops: number;
}

export interface ShareResult {
  groupId: string;
  tripCreated: boolean;
  created: ShareCounts;
}

/**
 * `conflict`: a change from another server met a copy that had moved since (F-S4d).
 * `add-request`: a member on another server asks the reader to offer the trip to someone (F-S4e).
 */
export type ShareNoticeKind =
  "shared" | "created" | "updated" | "deleted" | "left" | "conflict" | "add-request";

/** The entry types a notice may name (S2); `trip` for shared/left. */
export type ShareEntityType =
  | "trip"
  | "flight"
  | "lodgingStay"
  | "cruise"
  | "rail"
  | "bus"
  | "ferry"
  | "rental"
  | "roadtrip"
  | "tour"
  | "stop";

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
  /** `created`: the reader's own entry was linked instead of a copy being made. */
  joined?: boolean;
  /** `created`, joined: the reader's own entry was moved here from this trip of theirs. */
  movedFrom?: { tripId: string; tripName: string };
  /** `created`, moved: "share" when sharing the trip moved it, absent for a later addition. */
  via?: "share";
  /** `left` across servers: the consent was withdrawn, not just the trip left (F-S4e). */
  revoked?: boolean;
  /** `add-request`: whom the member on the other server asks the reader to add, and why. */
  person?: { displayName: string; origin?: string };
  note?: string;
  /** `shared`: taken without a question because the reader's consent said yes beforehand. */
  autoAccepted?: boolean;
  /** `shared` by linking an existing copy (forgejo#440): how many entries were joined, nothing copied. */
  linked?: { matched: number; decision: string | null };
}

/** A person on another server, as their server names them: shown as „Ben (andere.instanz.tld)". */
export interface RemoteActor {
  displayName: string;
  origin: string;
  /** The server that relayed the change, when it is not the author's own (the trip's home). */
  via?: string;
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
  /** The person on another server who made the change; null for a change made here. */
  remoteActor: RemoteActor | null;
  /** `updated`: every changed fact, old and new; `conflict`: the reader's value, then theirs. */
  changes: ShareNoticeChange[];
}

/** A trip shared with the reader, not looked at yet (`GET /sharing/received-trips`). */
export interface ReceivedTripItem {
  kind: "shared" | "offer";
  /** The notice (`shared`) or the offer (`offer`). */
  id: string;
  /** The reader's own trip; null for an offer not answered yet. */
  tripId: string | null;
  tripName: string;
  from: { displayName: string; origin: string | null };
  /** Taken without a question because the reader's consent said yes beforehand. */
  autoAccepted: boolean;
  /** The reader's own trip was linked with the sender's copy (sharing UAT 2). */
  linked?: boolean;
}

export interface ReceivedTrips {
  items: ReceivedTripItem[];
  count: number;
}
