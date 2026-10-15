import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import { useMemo } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useAuthStore } from "../../store/authStore";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { usePlacesVisible } from "../../hooks/usePlacesVisible";
import { useRailVisible } from "../../hooks/useRailVisible";
import { useRentalVisible } from "../../hooks/useRentalVisible";
import { useFerryVisible } from "../../hooks/useFerryVisible";
import { useBusVisible } from "../../hooks/useBusVisible";
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
 * Ortslisten) and Werkzeuge (Parser, while an admin's beta switch is on).
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
export function useNavItems(pathname = "/"): {
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
