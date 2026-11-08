/**
 * Wire types of /api/v1/friends — spec 2026-11-07 §11.4. One friend is one connection, local or
 * remote; the switches are directional (`mine` is what the reader gives, `theirs` what the friend
 * gives). The backend schema (`backend/src/schemas/friends.ts`) is the contract.
 */
import type { ConnectionState, ConnectionSwitches } from "../../types/sharingRemote";
import type { LeaderboardScope, OwnAdmission } from "../comparison/types";

export interface Friend {
  /** `local:<id>` or `remote:<id>`; the same key the comparison endpoints take. */
  key: string;
  kind: "local" | "remote";
  username: string;
  displayName: string;
  origin: string | null;
  state: ConnectionState;
  mine: ConnectionSwitches;
  theirs: ConnectionSwitches;
  requestedAt: string | null;
  confirmedAt: string | null;
  /** The `/sharing/connections` id of a remote connection; null for a local friend or a bare pairing. */
  connectionId: string | null;
  /** The stored comparison scope behind the leaderboard switch; null = none stored. */
  scope: LeaderboardScope | null;
  /** The peer server lacks the `connections` feature — comparison only (§11.7). */
  olderServer: boolean;
}

/**
 * An incoming request is a friend row in state `pending_in`, plus what the asker offers
 * (`switches`, same as `theirs`), the switches the reader chose on their own link (`proposed`) and
 * the redeem facts.
 */
export interface FriendRequest extends Friend {
  switches: ConnectionSwitches | null;
  proposed: ConnectionSwitches | null;
  viaLink: boolean;
  fingerprint: string | null;
}

export interface FriendsResponse {
  friends: Friend[];
  requests: FriendRequest[];
  admissions: OwnAdmission[];
  /** Whether this server can reach people on other servers right now. */
  federationAvailable: boolean;
}

export type CopyState = "linked" | "pending" | "declined" | "removed";

/** Shape of one shared trip. `localTripId` is the trip to open on this server, if any. */
export interface SharedTrip {
  id: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  copyState: CopyState;
  localTripId: string | null;
}
export interface FriendTrips {
  toThem: SharedTrip[];
  fromThem: SharedTrip[];
}

/** A plan both are members of; `owner` says whose trip it is, `role` the reader's role. */
export interface SharedPlan {
  id: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  owner: "me" | "them";
  role: string;
}
export interface FriendPlans {
  plans: SharedPlan[];
}
