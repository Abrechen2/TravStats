import { useMemo } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useAuthStore } from "../../store/authStore";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { usePlacesVisible } from "../../hooks/usePlacesVisible";
import { AVAILABLE_DOMAINS, DOMAINS } from "../../shared/domains";
import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import type { IconName } from "../ui/Icon";

export interface NavLeaf {
  kind: "leaf";
  id: string;
  path: string;
  label: string;
  icon?: IconName;
  badge?: number;
  warn?: boolean;
  betaBadge?: boolean;
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
 * Ortslisten) and Werkzeuge (Posteingang, Parser, Admin). Settings and logout
 * live behind the avatar. The old header carried seven top-level entries plus
 * Support and System chips, and wrapped into a hamburger below 1280px.
 *
 * The model draws only what the product has. The design's Schnellsuche,
 * Import-Logbuch page and Mitreisende page do not exist yet, so they are not
 * here — an entry that leads nowhere is worse than none.
 *
 * `inboxCount` is the WHOLE Posteingang — pending flight updates plus open
 * data-quality questions, summed by `NavigationBar`. It reads no router state,
 * so the model stays testable without a router.
 */
export function useNavItems(inboxCount: number): {
  primary: NavNode[];
  more: NavSection[];
} {
  const { t } = useTranslation(["dashboard", "common", "trips", "passport", "dataQuality"]);
  const user = useAuthStore((s) => s.user);
  const { isEnabled } = useEnabledDomains();
  const { isFeatureVisible } = useBetaFeatures();
  const placesVisible = usePlacesVisible();
  const isAdmin = user?.isAdmin ?? false;

  return useMemo(() => {
    // `poi` asks through `usePlacesVisible`, the one home of the places rule.
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

    // The path stays `/pending-updates` although the page is the Posteingang:
    // it is bookmarked, and `Settings/AutoUpdateSection` links to it.
    //
    // The entry is ALWAYS there (owner rule 2026-09-05): an empty inbox must
    // still be reachable from the menu, and the badge alone says whether it
    // is empty.
    const hasOpenItems = inboxCount > 0;
    const tools: NavLeaf[] = [
      {
        kind: "leaf",
        id: "inbox",
        path: "/pending-updates",
        label: t("dataQuality:inbox.nav"),
        icon: "inbox",
        ...(hasOpenItems ? { badge: inboxCount, warn: true } : {}),
      },
      ...(isAdmin
        ? [
            // The badge and the gate agree: offered only while the instance
            // beta switch is on (see `parserTemplates` in config/betaFeatures.ts).
            ...(isFeatureVisible("parserTemplates")
              ? [
                  {
                    kind: "leaf" as const,
                    id: "parser",
                    path: "/parser",
                    label: t("dashboard:parser"),
                    icon: "mail" as const,
                    betaBadge: true,
                  },
                ]
              : []),
            {
              kind: "leaf" as const,
              id: "admin",
              path: "/admin",
              label: t("dashboard:admin"),
              icon: "shield" as const,
            },
          ]
        : []),
    ];

    const more: NavSection[] = [
      { id: "collections", label: t("dashboard:nav.collections"), items: collections },
      { id: "tools", label: t("dashboard:nav.tools"), items: tools },
    ];

    return { primary, more };
  }, [t, isEnabled, isFeatureVisible, placesVisible, isAdmin, inboxCount]);
}
