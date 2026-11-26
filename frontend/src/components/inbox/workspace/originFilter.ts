import type { InboxItem, Translate } from "./model";

/**
 * The inbox's source filter (owner 2026-11-26): "Alle", each smart list, each plugin, Kalender,
 * Fotos, TravTrack. A suggestion can have several origins (a list's match the calendar also
 * names); it is shown under each. It only filters; nothing is changed.
 */
export interface Origin {
  key: string;
  label: string;
}

const KIND_ORDER = ["smartList", "plugin", "calendar", "photos", "travtrack"];

export function originsOf(item: InboxItem, t: Translate): Origin[] {
  switch (item.source) {
    case "photos":
      return [{ key: "photos", label: t("dataQuality:inbox.workspace.origin.photos") }];
    case "location":
      return [{ key: "travtrack", label: t("dataQuality:inbox.workspace.origin.travtrack") }];
    case "dawarich":
      return (item.data.sources ?? []).flatMap((s): Origin[] => {
        if (s.kind === "smartList" || s.kind === "plugin")
          return s.id ? [{ key: `${s.kind}:${s.id}`, label: s.name ?? s.id }] : [];
        if (s.kind === "calendar" || s.kind === "travtrack")
          return [{ key: s.kind, label: t(`dataQuality:inbox.workspace.origin.${s.kind}`) }];
        return [];
      });
    default:
      return [];
  }
}

/** The chips with a count each, in a fixed order; an origin no item carries has no chip. */
export function originChips(items: InboxItem[], t: Translate): (Origin & { count: number })[] {
  const byKey = new Map<string, Origin & { count: number }>();
  for (const item of items) {
    for (const o of originsOf(item, t)) {
      const chip = byKey.get(o.key) ?? { ...o, count: 0 };
      chip.count += 1;
      byKey.set(o.key, chip);
    }
  }
  const rank = (key: string) => KIND_ORDER.indexOf(key.split(":")[0]);
  return [...byKey.values()].sort(
    (a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label)
  );
}

export function hasOrigin(item: InboxItem, origin: string | null, t: Translate): boolean {
  return origin === null || originsOf(item, t).some((o) => o.key === origin);
}
