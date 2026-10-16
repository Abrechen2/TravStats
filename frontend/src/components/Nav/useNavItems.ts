import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import { useMemo } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useAuthStore } from "../../store/authStore";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { usePlacesVisible } from "../../hooks/usePlacesVisible";
import { useTravPlanVisible } from "../../hooks/useTravPlanVisible";
import { AVAILABLE_DOMAINS, DOMAINS } from "../../shared/domains";
import type { IconName } from "../ui/Icon";

export interface NavLeaf {
  kind: "leaf";
  id: string;
  path: string;
  label: string;
  icon?: IconName;
  badge?: number;
  warn?: boolean;
}

export interface NavGroup {
  kind: "group";
  id: string;
  label: string;
  badge?: number;
  children: NavLeaf[];
}

export type NavNode = NavLeaf | NavGroup;

/** One labelled block of the "Mehr" menu: Sammlungen, Werkzeuge. */
export interface NavSection {
  id: string;
  label: string;
  items: NavLeaf[];
}

export function isPathActive(path: string, pathname: string): boolean {
  if (path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function isNodeActive(node: NavNode, pathname: string): boolean {
  if (node.kind === "leaf") return isPathActive(node.path, pathname);
  return node.children.some((c) => isPathActive(c.path, pathname));
}

/** A group with exactly one visible child renders as that child (owner rule:
 *  no one-item dropdowns). */
function collapseSingleChild(group: NavGroup): NavNode {
  if (group.children.length === 1) return { ...group.children[0], id: group.id };
  return group;
}

/**
 * The header's navigation model, round 4 (decision E1).
 *
 * Four primary destinations — Dashboard, Logbuch, Reisen, Statistik — and
 * everything else in "Mehr", in two sections: Sammlungen (Erfolge, Reisepass,
 * Ortslisten, Vergleich) and Werkzeuge (Parser for admins; the encrypted share
 * while the beta switch is on).
 * Settings, Admin and logout live behind the avatar (`UserMenu`); Posteingang
 * is the header's own icon (`NavigationBar`), with its own badge. The old
 * header carried seven top-level entries plus Support and System chips, and
 * wrapped into a hamburger below 1280px.
 *
 * T4 (2026-09-17 tester feedback) removed BOTH the Posteingang and the Admin
 * leaves that used to live here: Posteingang was drawn twice (once as the
 * header icon, once as this menu entry), and Admin sat in "Mehr" rather than
 * beside the other account-level actions.
 *
 * The model draws only what the product has. The design's Schnellsuche,
 * Import-Logbuch page and Mitreisende page do not exist yet, so they are not
 * here — an entry that leads nowhere is worse than none.
 */
export function useNavItems(): {
  primary: NavNode[];
  more: NavSection[];
} {
  const { t } = useTranslation([
    "dashboard",
    "common",
    "trips",
    "passport",
    "dataQuality",
    "stats",
    "notes",
    "comparison",
    "encryptedShare",
    "travplan",
  ]);
  const user = useAuthStore((s) => s.user);
  const { isEnabled } = useEnabledDomains();
  const placesVisible = usePlacesVisible();
  const isAdmin = user?.isAdmin ?? false;
  const { isFeatureVisible } = useBetaFeatures();
  const comparisonVisible = isFeatureVisible("comparison");
  const encryptedShareVisible = isFeatureVisible("encryptedShare");
  const travPlanVisible = useTravPlanVisible();

  return useMemo(() => {
    // `poi` asks through `usePlacesVisible`, the one home of the places rule;
    // every other domain's beta switch is already applied by `isEnabled`.
    const domainChildren: NavLeaf[] = AVAILABLE_DOMAINS.filter((key) =>
      key === "poi" ? placesVisible : isEnabled(key)
    ).map((key) => ({
      kind: "leaf",
      id: `domain-${key}`,
      path: DOMAINS[key].routePrefix,
      label: t(`common:${DOMAINS[key].i18nKey}`),
    }));

    const primary: NavNode[] = [
      // `/dashboard`, not `/`: the root only redirects, so an entry pointing at
      // `/` was never marked active on the page it leads to.
      { kind: "leaf", id: "dashboard", path: "/dashboard", label: t("dashboard:title") },
      ...(domainChildren.length > 0
        ? [
            collapseSingleChild({
              kind: "group",
              id: "logbook",
              label: t("dashboard:nav.logbook"),
              children: domainChildren,
            }),
          ]
        : []),
      { kind: "leaf", id: "trips", path: "/trips", label: t("trips:tab") },
      { kind: "leaf", id: "stats", path: "/stats", label: t("dashboard:stats") },
    ];

    const collections: NavLeaf[] = [
      {
        kind: "leaf",
        id: "achievements",
        path: "/achievements",
        label: t("dashboard:achievements"),
        icon: "trophy",
      },
      // Standalone notes (forgejo#137) belong to no domain and no trip, so the
      // entry is there whatever domains are on — a moment needs no flight.
      // A collection like the others here: something the user keeps, not a
      // logbook of one kind of travel.
      {
        kind: "leaf",
        id: "notes",
        path: "/notes",
        label: t("notes:title"),
        icon: "pencil",
      },
      // Built from flights alone, so it is offered only when flights are on —
      // an entry leading to a page that explains why it is empty is worse than
      // no entry.
      ...(isEnabled("flight")
        ? [
            {
              kind: "leaf" as const,
              id: "passport",
              path: "/passport",
              label: t("passport:title"),
              icon: "book-open" as const,
            },
            // Same condition, and for the same reason: the year in review is
            // built from flights, and an entry leading to a page that explains
            // why it is empty is worse than no entry.
            //
            // `/wrapped`, not `/stats/wrapped`: `isPathActive` marks a parent
            // active for its children, so the nested path highlighted the
            // Statistik entry alongside this leaf.
            {
              kind: "leaf" as const,
              id: "wrapped",
              path: "/wrapped",
              label: t("stats:wrapped.title"),
              icon: "sparkles" as const,
            },
          ]
        : []),
      // Friends' totals beside the year in review: the other "how am I doing" page. Its own
      // icon — the trophy belongs to the achievements (rework 2026-10-16).
      ...(comparisonVisible
        ? [
            {
              kind: "leaf" as const,
              id: "comparison",
              path: "/compare",
              label: t("comparison:title"),
              icon: "users" as const,
            },
          ]
        : []),
      ...(placesVisible
        ? [
            {
              kind: "leaf" as const,
              id: "place-lists",
              path: "/places/lists",
              label: t("dashboard:nav.placeLists"),
              icon: "list" as const,
            },
          ]
        : []),
    ];

    // T4 (2026-09-17 tester feedback): Posteingang left this list entirely —
    // it is the header's own icon now (`NavigationBar`), and drawing it here
    // too duplicated it. Admin moved into `UserMenu`, beside settings.
    const tools: NavLeaf[] = [
      // Out of beta on 2026-09-17 (owner decision): the gate asked for the
      // template and regex parsers to be measured against the sample set,
      // and they were — 31 of 31 flight mails, 97 of 108 lodging, 4 of 4
      // cruise, without an LLM. Admin-only, as it has always been.
      ...(isAdmin
        ? [
            {
              kind: "leaf" as const,
              id: "parser",
              path: "/parser",
              label: t("dashboard:parser"),
              icon: "mail" as const,
            },
          ]
        : []),
      ...(encryptedShareVisible
        ? [
            {
              kind: "leaf" as const,
              id: "encrypted-share",
              path: "/encrypted-share",
              label: t("encryptedShare:nav"),
              icon: "key-round" as const,
            },
          ]
        : []),
    ];

    // TravPlan used to swap this whole model for its own eight sections on
    // `/plan*`, so a planner lost the way back to the rest of the app. It is
    // one destination here instead; its sections live on its own page.
    const planning: NavLeaf[] = travPlanVisible
      ? [
          {
            kind: "leaf",
            id: "travplan",
            path: "/plan",
            label: t("travplan:title"),
            icon: "calendar",
          },
        ]
      : [];

    const more: NavSection[] = [
      { id: "collections", label: t("dashboard:nav.collections"), items: collections },
      { id: "tools", label: t("dashboard:nav.tools"), items: tools },
      ...(planning.length > 0
        ? [{ id: "planning", label: t("travplan:title"), items: planning }]
        : []),
    ];

    return { primary, more };
  }, [
    t,
    isEnabled,
    placesVisible,
    isAdmin,
    comparisonVisible,
    encryptedShareVisible,
    travPlanVisible,
  ]);
}
