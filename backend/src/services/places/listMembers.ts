/**
 * One page of a place list as a table (owner 2026-11-26): name, country, town, visits (count,
 * first, last, the dates themselves), how the place got in, the distance from home and a
 * plugin-fed list's own columns — sorted and paged on the server.
 *
 * Sort-then-slice, deliberately: the visit keys (count, first, last) and the distance are derived
 * per place and cannot be pushed into one Prisma `orderBy`. The work is bounded by the list's
 * size (one light read of its members and their visits — the largest real list has ~150), and
 * every key ends in the same total ordering (name, then entry id), so pages never skip or repeat.
 *
 * The purpose filter (`?purposeFilter=`) needs nothing here: the entry scope narrows the Place
 * and PlaceVisit reads below, so a business filter keeps the places with a business visit and
 * counts only those visits.
 */
import { prisma } from "../../db";
import { LIST_SORT_KEYS } from "../../schemas/placeList";
import { classifyVisit } from "../../shared/placeCounting";
import { haversineKm } from "../../shared/geo/haversine";
import { deriveHomePlace } from "../home/homePlace";
import { pluginColumnsOf, PLUGIN_ENTRY_CREATED_BY, type PluginListColumn } from "./pluginLists";

export { LIST_SORT_KEYS };
export type ListSortKey = (typeof LIST_SORT_KEYS)[number];
export type ListMemberSource = "manual" | "rule" | "import" | "plugin";

/** Visit dates shown under an expanded row; the count is always the full one. */
export const MAX_VISITS_PER_ROW = 50;

export interface ListMemberRow {
  entryId: string;
  placeId: string;
  name: string;
  category: string;
  country: string | null;
  countryCode: string | null;
  city: string | null;
  visitCount: number;
  /** Local calendar days, `YYYY-MM-DD`; null without a dated past visit. */
  firstVisit: string | null;
  lastVisit: string | null;
  addedAt: string;
  sortIdx: number;
  source: ListMemberSource;
  distanceKm: number | null;
  external: { id: string; label?: string; fields: Record<string, string> } | null;
  /** Past visits, newest first, at most MAX_VISITS_PER_ROW. */
  visits: { id: string; date: string | null }[];
}

export interface ListMembersPage {
  rows: ListMemberRow[];
  total: number;
  page: number;
  pageSize: number;
  columns: PluginListColumn[];
  /** False when the account has no home: the distance column has nothing to show. */
  hasHome: boolean;
}

export interface ListMembersQuery {
  sort: ListSortKey;
  order: "asc" | "desc";
  page: number;
  pageSize: number;
  q?: string;
}

const dayOf = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

function sourceOf(
  entryCreatedBy: string | null,
  place: { createdBy: string | null; dataSource: string | null }
): ListMemberSource {
  if (entryCreatedBy === "brandRule") return "rule";
  if (entryCreatedBy === PLUGIN_ENTRY_CREATED_BY) return "plugin";
  if (entryCreatedBy === "import" || place.createdBy === "import" || place.dataSource === "import")
    return "import";
  return "manual";
}

type Comparable = string | number | null;

function keyOf(row: ListMemberRow, sort: ListSortKey): Comparable {
  switch (sort) {
    case "lastVisit":
      return row.lastVisit;
    case "firstVisit":
      return row.firstVisit;
    case "name":
      return row.name.toLocaleLowerCase();
    case "country":
      return row.country?.toLocaleLowerCase() ?? row.countryCode;
    case "visitCount":
      return row.visitCount;
    case "addedAt":
      return row.addedAt;
    case "distance":
      return row.distanceKm;
    case "custom":
      return row.sortIdx;
  }
}

/**
 * The table's order: the key in the asked direction, a missing value last in either direction
 * (an unvisited place is not "the oldest visit"), then name and entry id ascending.
 */
export function compareRows(sort: ListSortKey, order: "asc" | "desc") {
  const dir = order === "asc" ? 1 : -1;
  return (a: ListMemberRow, b: ListMemberRow): number => {
    const ka = keyOf(a, sort);
    const kb = keyOf(b, sort);
    if (ka !== kb) {
      if (ka === null) return 1;
      if (kb === null) return -1;
      const c =
        typeof ka === "number" && typeof kb === "number"
          ? ka - kb
          : String(ka).localeCompare(String(kb));
      if (c !== 0) return c * dir;
    }
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    return a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0;
  };
}

/** null when the list is not the caller's. */
export async function listMembers(
  userId: string,
  listId: string,
  query: ListMembersQuery,
  now = new Date()
): Promise<ListMembersPage | null> {
  const list = await prisma.placeList.findFirst({
    where: { id: listId, userId },
    select: { id: true, pluginColumns: true },
  });
  if (!list) return null;

  const q = query.q?.trim();
  // Top-level Place read: the entry scope (purpose filter, hidden purposes) narrows it.
  const places = await prisma.place.findMany({
    where: {
      userId,
      listEntries: { some: { listId } },
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { city: { contains: q, mode: "insensitive" as const } },
              { country: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      category: true,
      country: true,
      isoCountryCode: true,
      city: true,
      lat: true,
      lon: true,
      createdBy: true,
      dataSource: true,
      listEntries: {
        where: { listId },
        select: { id: true, sortIdx: true, createdBy: true, createdAt: true, externalFields: true },
      },
    },
  });
  const placeIds = places.map((p) => p.id);
  const visits =
    placeIds.length === 0
      ? []
      : await prisma.placeVisit.findMany({
          where: { userId, placeId: { in: placeIds } },
          select: { id: true, placeId: true, visitedAt: true, visitedAtUtc: true },
          orderBy: [{ visitedAt: "desc" }, { id: "asc" }],
        });
  const byPlace = new Map<string, typeof visits>();
  for (const v of visits) {
    if (classifyVisit(v, now) !== "visited") continue;
    const arr = byPlace.get(v.placeId) ?? [];
    arr.push(v);
    byPlace.set(v.placeId, arr);
  }

  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { data: true, homePlace: true },
  });
  const { homePlace } = await deriveHomePlace(settings);

  const rows: ListMemberRow[] = places.flatMap((p) => {
    const entry = p.listEntries[0];
    if (!entry) return [];
    const own = byPlace.get(p.id) ?? [];
    const dated = own.filter((v) => v.visitedAt !== null);
    const external = entry.externalFields as ListMemberRow["external"];
    return [
      {
        entryId: entry.id,
        placeId: p.id,
        name: p.name,
        category: p.category,
        country: p.country,
        countryCode: p.isoCountryCode,
        city: p.city,
        visitCount: own.length,
        lastVisit: dayOf(dated[0]?.visitedAt ?? null),
        firstVisit: dayOf(dated[dated.length - 1]?.visitedAt ?? null),
        addedAt: entry.createdAt.toISOString(),
        sortIdx: entry.sortIdx,
        source: sourceOf(entry.createdBy, p),
        distanceKm: homePlace
          ? Math.round(haversineKm(homePlace, { lat: p.lat, lon: p.lon }) * 10) / 10
          : null,
        external: external && typeof external === "object" && "id" in external ? external : null,
        visits: own
          .slice(0, MAX_VISITS_PER_ROW)
          .map((v) => ({ id: v.id, date: dayOf(v.visitedAt) })),
      },
    ];
  });

  rows.sort(compareRows(query.sort, query.order));
  const start = (query.page - 1) * query.pageSize;
  return {
    rows: rows.slice(start, start + query.pageSize),
    total: rows.length,
    page: query.page,
    pageSize: query.pageSize,
    columns: pluginColumnsOf(list.pluginColumns),
    hasHome: homePlace !== null,
  };
}
