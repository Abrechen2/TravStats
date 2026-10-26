import { isPathActive, type NavLeaf } from "./useNavItems";

/**
 * The three areas of the app (TravTrack plan, phase 5, header variant B):
 * Stats is everything that existed before, Plan is TravPlan, Track is the own
 * location history. The header's logo spells them — "Trav" and the words —
 * and the active area's menu follows a divider.
 */
export type AreaId = "stats" | "plan" | "track";

/** The order the words stand in the logo. */
export const AREA_ORDER: readonly AreaId[] = ["stats", "plan", "track"];

/** Where a word leads. Stats leads to the dashboard, as the old logo did. */
export const AREA_HOME: Record<AreaId, string> = {
  stats: "/dashboard",
  plan: "/plan",
  track: "/track",
};

/**
 * The area follows the route, never a stored choice: a bookmark into
 * `/track/explored` opens Track whatever the last session showed.
 */
export function areaForPath(pathname: string): AreaId {
  if (isPathActive("/plan", pathname)) return "plan";
  if (isPathActive("/track", pathname)) return "track";
  return "stats";
}

/**
 * The area the header shows. A route whose area is not offered (the page is on
 * its way to a redirect, or the visibility answer is still pending) shows
 * Stats, so the header never draws a menu for an area it has no word for.
 */
export function effectiveArea(pathname: string, visible: readonly AreaId[]): AreaId {
  const area = areaForPath(pathname);
  return visible.includes(area) ? area : "stats";
}

type Translate = (key: string) => string;

const DAY_PATH = /^\/track\/\d{4}-\d{2}-\d{2}$/;

/**
 * Track's own menu. Karte is `/track` and every `/track/:date`, but not the
 * sibling tabs — `isPathActive("/track")` would mark it on all of them.
 */
export function trackMenu(t: Translate): NavLeaf[] {
  return [
    {
      kind: "leaf",
      id: "track-map",
      path: "/track",
      label: t("track:menu.map"),
      icon: "map-pin",
      activeWhen: (pathname) => pathname === "/track" || DAY_PATH.test(pathname),
    },
    {
      kind: "leaf",
      id: "track-explored",
      path: "/track/explored",
      label: t("track:menu.explored"),
    },
    { kind: "leaf", id: "track-months", path: "/track/months", label: t("track:menu.stats") },
    { kind: "leaf", id: "track-stays", path: "/track/stays", label: t("track:menu.stays") },
    { kind: "leaf", id: "track-imports", path: "/track/imports", label: t("track:menu.imports") },
  ];
}

/**
 * Plan's menu, kept to what TravPlan has: the plans (its overview, and every
 * plan's own sections below it) and, for admins, its configuration.
 */
export function planMenu(t: Translate, isAdmin: boolean): NavLeaf[] {
  return [
    {
      kind: "leaf",
      id: "plan-overview",
      path: "/plan",
      label: t("travplan:menu.plans"),
      activeWhen: (pathname) =>
        isPathActive("/plan", pathname) && !isPathActive("/plan/admin", pathname),
    },
    ...(isAdmin
      ? [
          {
            kind: "leaf" as const,
            id: "plan-admin",
            path: "/plan/admin",
            label: t("travplan:menu.config"),
          },
        ]
      : []),
  ];
}
