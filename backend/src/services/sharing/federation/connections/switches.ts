/**
 * The switches of a user connection (spec 2026-11-02 §2): what each side gives, directional, all
 * off by default. `mine` is read from the columns of the row, `theirs` from what the other side
 * last announced (`remote_switches`). The gates are what the rest of the federation code asks:
 * a feature starts only on an `active` connection and only where the owning side's switch is on —
 * a `reconfirm` pairing (made before connections existed) keeps its trips and grants nothing new.
 */
import {
  connectionSwitchesSchema,
  type ConnectionSwitches,
  type StatsLevel,
} from "../../../../schemas/tripSharePeer";

export const ALL_OFF: ConnectionSwitches = {
  plans: false,
  stats: "off",
  achievements: false,
  leaderboard: false,
  tripOffers: false,
};

export interface SwitchColumns {
  sharePlans: boolean;
  statsLevel: string;
  shareAchievements: boolean;
  shareLeaderboard: boolean;
  shareTripOffers: boolean;
  remoteSwitches: unknown;
}

const STATS = new Set<string>(["off", "overview", "full"]);

export const mineOf = (row: SwitchColumns): ConnectionSwitches => ({
  plans: row.sharePlans,
  stats: (STATS.has(row.statsLevel) ? row.statsLevel : "off") as StatsLevel,
  achievements: row.shareAchievements,
  leaderboard: row.shareLeaderboard,
  tripOffers: row.shareTripOffers,
});

/** The other side's switches; anything that does not parse reads as all off (fail closed). */
export const theirsOf = (row: Pick<SwitchColumns, "remoteSwitches">): ConnectionSwitches => {
  const parsed = connectionSwitchesSchema.safeParse(row.remoteSwitches);
  return parsed.success ? parsed.data : ALL_OFF;
};

/** The columns a set of switches writes. */
export const columnsOf = (s: ConnectionSwitches) => ({
  sharePlans: s.plans,
  statsLevel: s.stats,
  shareAchievements: s.achievements,
  shareLeaderboard: s.leaderboard,
  shareTripOffers: s.tripOffers,
});

type Gated = Pick<SwitchColumns, "remoteSwitches" | "shareTripOffers" | "statsLevel"> & {
  state: string;
};

/** This side may offer a trip to the person: connected, and they said they accept offers. */
export const mayOfferTo = (row: Gated): boolean =>
  row.state === "active" && theirsOf(row).tripOffers;

/** An offer from the person is taken: connected, and this side accepts offers. */
export const mayReceiveOfferFrom = (row: Gated): boolean =>
  row.state === "active" && row.shareTripOffers;

/** The person's statistics read is served: connected, and this side's level is above off. */
export const mayServeStats = (row: Gated): boolean =>
  row.state === "active" && row.statsLevel !== "off";
