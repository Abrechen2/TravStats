import { useMemo } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useAuthStore } from "../../store/authStore";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { usePlacesVisible } from "../../hooks/usePlacesVisible";
import { AVAILABLE_DOMAINS, DOMAINS } from "../../shared/domains";
import { useBetaFeatures } from "../../hooks/useBetaFeatures";

export interface NavLeaf {
  kind: "leaf";
  id: string;
  path: string;
  label: string;
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

export function isPathActive(path: string, pathname: string): boolean {
  if (path === "/") return pathname === "/";
  return pathname.startsWith(path);
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
 * Pure nav model for NavigationBar (desktop + mobile render the same tree).
 * It reads no router state, so the model stays testable without a router.
 *
 * `inboxCount` is the WHOLE Posteingang — pending flight updates plus open
 * data-quality questions. Two tables, one badge: the user is being told there
 * is something to answer, and splitting that into two numbers would make them
 * open the page twice to find out which. `NavigationBar` sums it.
 */
export function useNavItems(inboxCount: number): { center: NavNode[]; system: NavNode } {
  const { t } = useTranslation(["dashboard", "common", "trips", "passport", "dataQuality"]);
  const user = useAuthStore((s) => s.user);
  const { isEnabled } = useEnabledDomains();
  const { isFeatureVisible } = useBetaFeatures();
  const placesVisible = usePlacesVisible();
  const isAdmin = user?.isAdmin ?? false;

  return useMemo(() => {
    // `poi` is available but still behind the instance beta gate, so it needs
    // BOTH checks — the user's own enabled-domains choice and the flag. See
    // hooks/usePlacesVisible.ts.
    const domainChildren: NavLeaf[] = AVAILABLE_DOMAINS.filter((key) =>
      key === "poi" ? placesVisible : isEnabled(key)
    ).map((key) => ({
      kind: "leaf",
      id: `domain-${key}`,
      path: DOMAINS[key].routePrefix,
      label: t(`common:${DOMAINS[key].i18nKey}`),
    }));

    const center: NavNode[] = [
      { kind: "leaf", id: "dashboard", path: "/", label: t("dashboard:title") },
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
      {
        kind: "leaf",
        id: "achievements",
        path: "/achievements",
        label: t("dashboard:achievements"),
      },
      // Built from flights alone, so it is offered only when flights are on —
      // an entry leading to a page that explains why it is empty is worse than
      // no entry. It sat behind the beta gate while 2.6.0 was a candidate; the
      // gate's own condition ("or 2.7.0 opens") came true on 2026-09-05.
      ...(isEnabled("flight")
        ? [
            {
              kind: "leaf" as const,
              id: "passport",
              path: "/passport",
              label: t("passport:title"),
            },
          ]
        : []),
    ];

    // The path stays `/pending-updates` although the page is now the
    // Posteingang: it is bookmarked, and `Settings/AutoUpdateSection` links to
    // it. Only the label changed.
    //
    // The entry is ALWAYS there. Until 2026-09-05 it appeared only while
    // something was open (or while already on the page), so an empty inbox had
    // no way in from the UI at all — the owner's rule is that the Posteingang
    // is reachable from the menu, and the badge alone says whether it is
    // empty. A dropdown with two entries is the price, and it is the right one.
    const hasOpenItems = inboxCount > 0;
    const systemChildren: NavLeaf[] = [
      { kind: "leaf", id: "settings", path: "/settings", label: t("dashboard:settings") },
      {
        kind: "leaf",
        id: "pending-updates",
        path: "/pending-updates",
        label: t("dataQuality:inbox.nav"),
        ...(hasOpenItems ? { badge: inboxCount, warn: true } : {}),
      },
      ...(isAdmin
        ? [
            { kind: "leaf" as const, id: "admin", path: "/admin", label: t("dashboard:admin") },
            // The badge and the gate now agree: the page is offered only while
            // the instance beta switch is on (owner decision 2026-09-05, see
            // `parserTemplates` in config/betaFeatures.ts). Before that the
            // badge was a label with nothing behind it.
            ...(isFeatureVisible("parserTemplates")
              ? [
                  {
                    kind: "leaf" as const,
                    id: "parser",
                    path: "/parser",
                    label: t("dashboard:parser"),
                    betaBadge: true,
                  },
                ]
              : []),
          ]
        : []),
    ];

    const system = collapseSingleChild({
      kind: "group",
      id: "system",
      label: t("dashboard:nav.system"),
      badge: inboxCount > 0 ? inboxCount : undefined,
      children: systemChildren,
    });

    return { center, system };
  }, [t, isEnabled, placesVisible, isAdmin, inboxCount]);
}
