import type { PhotoSourceKind } from "./types";
import { prisma } from "../../db";
import { getPhotoSourceConnection } from "./connection";

/**
 * "In Immich öffnen" / "In PhotoPrism öffnen": a link into the source's own web
 * UI, narrowed to the entry's dates (and place, where the UI can filter on one),
 * for the photos the automatic linker left out.
 *
 * - Immich: `/search?query=<JSON>` — the search page reads its terms from that
 *   JSON (`takenAfter`, `takenBefore`: ISO instants; verified against
 *   `web/src/routes/(user)/search` in immich-app/immich, 2026-11-21). Immich's
 *   search has no radius filter and the map page takes no coordinates, so the
 *   Immich link carries the time window only.
 * - PhotoPrism: `/library/browse?q=` with the documented filters `after:` (on
 *   or after, a date), `before:` (excludes the date) and `lat:` `lng:` `dist:`
 *   (km) — docs.photoprism.app/user-guide/search/filters.
 *
 * The base URL is the one the server talks to. It may be an address only the
 * server can reach; the link is the user's to try, and a connection with no
 * base URL gets no link at all.
 */

export interface DeepLinkTarget {
  window: { start: Date; end: Date };
  point?: { lat: number; lon: number; radiusKm: number };
}

const DAY_MS = 86_400_000;
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

export function browseUrl(
  kind: PhotoSourceKind,
  baseUrl: string,
  target: DeepLinkTarget
): string | null {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) return null;
  const { window, point } = target;
  if (kind === "immich") {
    const query = JSON.stringify({
      takenAfter: window.start.toISOString(),
      takenBefore: window.end.toISOString(),
    });
    return `${base}/search?query=${encodeURIComponent(query)}`;
  }
  const terms = [
    `after:${isoDay(window.start)}`,
    // `before` excludes its date: the day after the last instant keeps that day in.
    `before:${isoDay(new Date(window.end.getTime() + DAY_MS))}`,
  ];
  if (point) {
    terms.push(
      `lat:${point.lat.toFixed(6)}`,
      `lng:${point.lon.toFixed(6)}`,
      `dist:${point.radiusKm}`
    );
  }
  return `${base}/library/browse?q=${encodeURIComponent(terms.join(" "))}`;
}

export interface OpenInLink {
  provider: PhotoSourceKind;
  url: string;
}

/**
 * One link per connected source that has a browsable base URL. A shared
 * (admin-global or ENV) connection's base URL is the instance's internal
 * address, often on the LAN: only an admin, or the owner of a connection of
 * their own (`source: "user"`), is given it. Anyone else gets no link.
 */
export async function openInLinks(
  userId: string,
  providers: readonly PhotoSourceKind[],
  target: DeepLinkTarget
): Promise<OpenInLink[]> {
  const out: OpenInLink[] = [];
  let admin: boolean | null = null;
  for (const provider of providers) {
    const connection = await getPhotoSourceConnection(provider, userId);
    if (connection && connection.source !== "user") {
      admin ??=
        (await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } }))
          ?.isAdmin ?? false;
      if (!admin) continue;
    }
    const url = connection ? browseUrl(provider, connection.baseUrl, target) : null;
    if (url) out.push({ provider, url });
  }
  return out;
}
