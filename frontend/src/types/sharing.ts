/**
 * Shared trips, phase S1 — the wire shapes of `/api/v1/sharing`
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

export interface TripSharing {
  groupId: string | null;
  members: SharePerson[];
  candidates: ShareCandidate[];
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

export interface ShareNotice {
  id: string;
  kind: ShareNoticeKind;
  entityType: string | null;
  /** For `trip`: the reader's own trip id. */
  entityKey: string | null;
  after: { tripName?: string } | null;
  createdAt: string;
  readAt: string | null;
  actor: SharePerson | null;
}
