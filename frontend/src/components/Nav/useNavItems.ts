import { useMemo } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useAuthStore } from "../../store/authStore";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { usePlacesVisible } from "../../hooks/usePlacesVisible";
import { AVAILABLE_DOMAINS, DOMAINS } from "../../shared/domains";

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
export function useNavItems(
  pendingUpdatesCount: number,
  pathname: string
): { center: NavNode[]; system: NavNode } {
  const { t } = useTranslation(["dashboard", "common", "trips", "passport"]);
  const user = useAuthStore((s) => s.user);
  const { isEnabled } = useEnabledDomains();
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
      // no entry.
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

    const showPendingUpdates = pendingUpdatesCount > 0 || pathname === "/pending-updates";
    const systemChildren: NavLeaf[] = [
      { kind: "leaf", id: "settings", path: "/settings", label: t("dashboard:settings") },
      ...(showPendingUpdates
        ? [
            {
              kind: "leaf" as const,
              id: "pending-updates",
              path: "/pending-updates",
              label: t("dashboard:pendingUpdates"),
              badge: pendingUpdatesCount,
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
      badge: pendingUpdatesCount > 0 ? pendingUpdatesCount : undefined,
      children: systemChildren,
    });

    return { center, system };
  }, [t, isEnabled, placesVisible, isAdmin, pendingUpdatesCount, pathname]);
}
