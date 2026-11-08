import type { ConnectionSwitches } from "../../types/sharingRemote";

/** A new connection starts with everything on (owner, 2026-11-08, spec §11.2.3); each part can be switched off. */
export const DEFAULT_SWITCHES: ConnectionSwitches = {
  plans: true,
  stats: "full",
  achievements: true,
  leaderboard: true,
  tripOffers: true,
};
