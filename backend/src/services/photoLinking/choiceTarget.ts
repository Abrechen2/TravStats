import { localDay, toLocal } from "../../shared/time/instant";
import { zoneOf } from "../../shared/time/zoneOf";
import type { DeepLinkTarget } from "../photoSource/deepLink";
import type { EntryPlan } from "./entryKinds";

/**
 * What "In Immich/PhotoPrism öffnen" narrows to for an entry: the span of its
 * windows, and — when every leg is at the same single point — that place. A
 * corridor or a two-airport flight has no one place, so only the dates carry.
 */
export function choiceTarget(plan: Exclude<EntryPlan, "untimed">): DeepLinkTarget {
  const starts = plan.legs.map((l) => l.window.start.getTime());
  const ends = plan.legs.map((l) => l.window.end.getTime());
  const window = { start: new Date(Math.min(...starts)), end: new Date(Math.max(...ends)) };
  const places = plan.legs.flatMap((l) => l.locations);
  const first = places[0];
  const sameSingle =
    first?.kind === "point" &&
    places.every((l) => l.kind === "point" && l.lat === first.lat && l.lon === first.lon);
  return sameSingle
    ? { window, point: { lat: first.lat, lon: first.lon, radiusKm: first.radiusKm } }
    : { window };
}

/** The zone of the entry's first place: where its rows are shown when a photo has no position. */
export function planZone(plan: Exclude<EntryPlan, "untimed">): string | null {
  const first = plan.legs.flatMap((l) => l.locations)[0];
  if (!first) return null;
  const at = first.kind === "point" ? first : first.from;
  return zoneOf(at);
}

/**
 * The wall clock (`YYYY-MM-DDTHH:mm:ss`) at which a photo was taken, read in the
 * zone of the place it was taken at, else the entry's zone. Null when neither is
 * known — never UTC, which would show a time nobody lived (ADR 0002).
 */
export function takenAtLocal(
  iso: string | null,
  photo: { lat: number | null; lon: number | null } | null,
  fallbackZone: string | null
): string | null {
  if (!iso) return null;
  const own = photo && photo.lat !== null && photo.lon !== null ? zoneOf(photo) : null;
  const zone = own ?? fallbackZone;
  if (!zone) return null;
  try {
    return toLocal(iso, zone).local;
  } catch {
    return null;
  }
}

/**
 * The local days a plan searches, first to last (`YYYY-MM-DD`), read in the entry's zone — what
 * "Fotos vom 3.–7. Mai" says. Without a zone the UTC days; the search itself is wider then.
 */
export function windowDays(plan: Exclude<EntryPlan, "untimed">): { from: string; to: string } {
  const zone = planZone(plan) ?? "UTC";
  const starts = plan.legs.map((l) => l.window.start.getTime());
  const ends = plan.legs.map((l) => l.window.end.getTime());
  return {
    from: localDay(new Date(Math.min(...starts)), zone),
    to: localDay(new Date(Math.max(...ends)), zone),
  };
}
