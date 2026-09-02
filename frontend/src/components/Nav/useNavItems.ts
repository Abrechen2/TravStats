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
 * `pathname` is passed in (not read via useLocation) so the model stays
 * testable without a router and so the caller controls re-render timing.
 */
/**
 * `inboxCount` is the WHOLE Posteingang — pending flight updates plus open
 * data-quality questions. Two tables, one badge: the user is being told there
 * is something to answer, and splitting that into two numbers would make them
 * open the page twice to find out which. `NavigationBar` sums it.
 */
export function useNavItems(
  inboxCount: number,
  pathname: string
): { center: NavNode[]; system: NavNode } {
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
      // no entry. Behind the beta gate as well while 2.6.0 is a candidate.
      ...(isFeatureVisible("passport") && isEnabled("flight")
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
    const showInbox = inboxCount > 0 || pathname === "/pending-updates";
    const systemChildren: NavLeaf[] = [
      { kind: "leaf", id: "settings", path: "/settings", label: t("dashboard:settings") },
      ...(showInbox
        ? [
            {
              kind: "leaf" as const,
              id: "pending-updates",
              path: "/pending-updates",
              label: t("dataQuality:inbox.nav"),
              badge: inboxCount,
              warn: true,
            },
          ]
        : []),
      ...(isAdmin
        ? [
            { kind: "leaf" as const, id: "admin", path: "/admin", label: t("dashboard:admin") },
            {
              kind: "leaf" as const,
              id: "parser",
              path: "/parser",
              label: t("dashboard:parser"),
              betaBadge: true,
            },
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
  }, [t, isEnabled, placesVisible, isAdmin, inboxCount, pathname]);
}
