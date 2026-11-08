/**
 * Wire types of /api/v1/friends — spec 2026-11-07 §11.4. One friend is one connection, local or
 * remote; the switches are directional (`mine` is what the reader gives, `theirs` what the friend
 * gives). Fields marked "assumed" are not spelled out in §11.4 and follow the F1 worker's build.
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
  /** Assumed: the stored comparison scope behind the leaderboard switch; null = none stored. */
  scope?: LeaderboardScope | null;
  /** Assumed: the peer server lacks the `connections` feature — comparison only (§11.7). */
  olderServer?: boolean;
}

/** An incoming request: the asker's switches are what they offer, the reader answers with their own. */
export interface FriendRequest {
  key: string;
  displayName: string;
  username: string;
  origin: string | null;
  /** Assumed: the asker's own switches (`theirs` of the future connection). */
  switches: ConnectionSwitches;
  requestedAt: string | null;
  /** Assumed: set when the request came from a redeemed invitation link (§11.8). */
  viaLink?: boolean;
  /** Assumed: the redeemer's server fingerprint, shown to the inviter for a remote redeem. */
  fingerprint?: string | null;
}

export interface FriendsResponse {
  friends: Friend[];
  requests: FriendRequest[];
  admissions: OwnAdmission[];
}

export type CopyState = "linked" | "pending" | "declined" | "removed";

/** Assumed shape of one shared trip. `localTripId` is the trip to open on this server, if any. */
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

/** Assumed shape of a plan both are members of. */
export interface SharedPlan {
  id: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
}
export interface FriendPlans {
  plans: SharedPlan[];
}
