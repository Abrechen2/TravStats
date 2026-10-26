/**
 * The views of `/track` besides the day, each at `/track/<view>`. A module of
 * its own so `trackRoutes` can list them without pulling the lazily loaded
 * page into App's bundle. A new tab is one entry here plus its body in
 * `TrackPage`'s `TAB_BODY` — a missing body is a type error.
 */
export const TRACK_TABS = ["explored", "months", "stays", "imports"] as const;
export type TrackTab = (typeof TRACK_TABS)[number];
