import type { ShareConsent } from "./sharing";

/** Mirrors `backend/src/schemas/sharingRemote.ts`. */
export interface RemoteSharingStatus {
  available: boolean;
  reason: "beta-off" | "switch-off" | "no-identity" | null;
  origin: string | null;
  /** At least one other server is admitted: enabled, and a ping reached it. */
  peerAdmitted: boolean;
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

/** Redeeming a code: the person, and `alreadyConnected` when this account redeemed it before. */
export interface ClaimedPerson extends RemotePerson {
  alreadyConnected?: true;
}

/** Mirrors `REMOTE_MEMBER_STATES` in `backend/src/schemas/sharingRemote.ts`. */
export type RemoteMemberState =
  "invited" | "active" | "declined" | "unreachable" | "suspended" | "left" | "revoked";

/**
 * Where the changes made here stand on their way to one remote member (F-S4d). Mirrors
 * `delivery` in `backend/src/schemas/sharingRemote.ts`.
 */
export interface RemoteDelivery {
  state: "delivered" | "pending" | "retrying" | "unreachable" | "rejected";
  /** `retrying`/`unreachable`: failing since; `rejected`: when it was refused. */
  stateSince: string | null;
  /** `retrying`: the failure kind; `rejected`: `schema`, `not-member` or `consent`. */
  reason: string | null;
  field: string | null;
  /** `rejected`: the entry the refused change was about. */
  label: string | null;
}

/** A person on another server as a member of one trip (F-S4c). */
export interface RemoteMember {
  id: string;
  remoteId: string;
  displayName: string;
  username: string;
  origin: string;
  state: RemoteMemberState;
  /** Why the state is what it is (`off`, `peer-blocked`, `restore`, …); null when fine. */
  stateReason: string | null;
  stateSince: string;
  delivery: RemoteDelivery;
}

export interface OfferablePerson {
  remoteId: string;
  displayName: string;
  username: string;
  origin: string;
}

/**
 * A person on another server on the trip, and whether their changes reach the reader (F-S4e).
 * `paired`/`accepted`: they do; `pending`/`declined`: they do not; `you`/`here`: the reader, or
 * someone on this server — nothing to answer. Mirrors `rosterPersonSchema`.
 */
export interface RosterPerson {
  ref: string;
  displayName: string;
  origin: string;
  relation: "you" | "paired" | "here" | "pending" | "accepted" | "declined";
}

export interface TripRemoteSharing {
  /** The server this trip came from; null when this server is its home. */
  homeOrigin: string | null;
  members: RemoteMember[];
  /** Everyone on the trip on other servers (F-S4e). */
  roster: RosterPerson[];
  /** A membership of the reader's waits for their confirmation (restore, block, new key). */
  reconfirmable: boolean;
  offerable: OfferablePerson[];
}

/** Asking the trip's home to offer it to someone (F-S4e). */
export interface AddRequestBody {
  displayName: string;
  origin?: string;
  note?: string;
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
  roster: { ref: string; displayName: string; origin: string }[];
  counts: OfferCounts;
  offeredAt: string;
}
