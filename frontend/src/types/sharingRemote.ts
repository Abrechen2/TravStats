import type { ShareConsent } from "./sharing";

/** Mirrors `backend/src/schemas/sharingRemote.ts`. */
export interface RemoteSharingStatus {
  available: boolean;
  reason: "beta-off" | "switch-off" | "no-identity" | null;
  origin: string | null;
}

export interface RemoteInvite {
  id: string;
  createdAt: string;
  expiresAt: string;
  /** The trip a trip page's invitation offers; null for a person-level one. */
  tripId: string | null;
}

export interface CreatedRemoteInvite extends RemoteInvite {
  /** `<origin>#trip:<64 hex>` — shown this once. */
  code: string;
}

export interface RemotePerson {
  id: string;
  origin: string;
  username: string;
  displayName: string;
  consent: ShareConsent["status"];
  createdAt: string;
}

/** Mirrors `REMOTE_MEMBER_STATES` in `backend/src/schemas/sharingRemote.ts`. */
export type RemoteMemberState =
  "invited" | "active" | "declined" | "unreachable" | "suspended" | "left" | "revoked";

/** A person on another server as a member of one trip (F-S4c). */
export interface RemoteMember {
  id: string;
  remoteId: string;
  displayName: string;
  username: string;
  origin: string;
  state: RemoteMemberState;
  /** What last went wrong (`entries-undelivered`, `entries-refused`, …); null when fine. */
  stateReason: string | null;
  stateSince: string;
}

export interface OfferablePerson {
  remoteId: string;
  displayName: string;
  username: string;
  origin: string;
}

export interface TripRemoteSharing {
  /** The server this trip came from; null when this server is its home. */
  homeOrigin: string | null;
  members: RemoteMember[];
  offerable: OfferablePerson[];
}

/** Entries per type an offer holds — the `countKey`s of the backend's share registry. */
export type OfferCounts = Record<
  | "flights"
  | "lodgingStays"
  | "cruises"
  | "railJourneys"
  | "busJourneys"
  | "ferryJourneys"
  | "rentals"
  | "stops",
  number
>;

export interface ReceivedOffer {
  id: string;
  from: { displayName: string; username: string; origin: string };
  trip: { name: string; startDay: string | null; endDay: string | null };
  roster: { displayName: string; origin: string }[];
  counts: OfferCounts;
  offeredAt: string;
}
