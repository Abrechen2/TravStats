import { z } from "zod";
import { decodeCursor, encodeCursor } from "./output";
import type { ToolDef, ToolResult } from "./types";

type Rec = Record<string, unknown>;
const arr = (v: unknown): Rec[] => (Array.isArray(v) ? (v as Rec[]) : []);
const pick = (o: Rec, keys: string[]): Rec =>
  Object.fromEntries(keys.map((k) => [k, o[k] ?? null]));
const iso = (ms: unknown): string | null =>
  typeof ms === "number" ? new Date(ms).toISOString() : null;

const DOMAINS = [
  "flight",
  "cruise",
  "lodging",
  "poi",
  "rail",
  "bus",
  "ferry",
  "rental",
  "roadtrip",
  "tour",
  "trip",
] as const;

const search_entries: ToolDef = {
  name: "search_entries",
  title: "Search entries",
  description:
    "Search the user's own entries (flights, trips, stays, places, rail, …) by text. Read-only.",
  wraps: [
    {
      method: "GET",
      path: "/search",
      query: ["q", "limit", "domains"],
      fields: [
        "data.hits[].domain",
        "data.hits[].id",
        "data.hits[].title",
        "data.hits[].subtitle",
        "data.hits[].date",
        "data.hits[].path",
        "data.failed",
        "data.more",
        "data.capped",
      ],
    },
  ],
  input: {
    q: z.string().min(1).max(200),
    domains: z.array(z.enum(DOMAINS)).max(DOMAINS.length).optional(),
    limit: z.number().int().min(1).max(25).default(10),
  },
  async run({ client, instance }, a) {
    const res = await client.get<{ data: Rec }>("/search", {
      q: a.q as string,
      limit: a.limit as number,
      domains: (a.domains as string[] | undefined)?.join(","),
    });
    const hits = arr(res.data.hits).map((h) => ({
      domain: h.domain,
      id: h.id,
      title: h.title,
      subtitle: h.subtitle ?? null,
      date: (h.date as Rec | null)?.date ?? null,
      datePrecision: (h.date as Rec | null)?.precision ?? null,
      zone: (h.date as Rec | null)?.zone ?? null,
      link: `${instance}${h.path as string}`,
    }));
    const failedDomains = arr(res.data.failed) as unknown as string[];
    return {
      summary: `${hits.length} hit(s)${failedDomains.length ? `; these domains failed to answer: ${failedDomains.join(", ")}` : ""}.`,
      data: {
        hits,
        failedDomains,
        moreDomains: res.data.more ?? [],
        capped: res.data.capped ?? false,
      },
    };
  },
};

const list_trips: ToolDef = {
  name: "list_trips",
  title: "List trips",
  description:
    "List the user's trips, newest first as the server orders them. Filter by text or status; page with `cursor`.",
  wraps: [
    {
      method: "GET",
      path: "/trips",
      query: ["q", "status", "limit", "offset"],
      fields: [
        "trips[].id",
        "trips[].name",
        "trips[].startDay",
        "trips[].endDay",
        "trips[].status",
        "trips[].countries",
        "trips[].category",
        "trips[]._count",
        "total",
        "truncated",
      ],
    },
  ],
  input: {
    q: z.string().max(200).optional(),
    status: z.enum(["planned", "in_progress", "completed"]).optional(),
    limit: z.number().int().min(1).max(50).default(20),
    cursor: z.string().max(200).optional(),
  },
  async run({ client, instance }, a) {
    const offset = decodeCursor(a.cursor as string | undefined);
    const limit = a.limit as number;
    const res = await client.get<Rec>("/trips", {
      q: a.q as string | undefined,
      status: a.status as string | undefined,
      limit,
      offset,
    });
    const trips = arr(res.trips).map((t) => ({
      id: t.id,
      name: t.name,
      start: t.startDay ?? null,
      end: t.endDay ?? null,
      status: t.status,
      category: t.category ?? null,
      countries: t.countries ?? [],
      entryCount: Object.values((t._count as Record<string, number> | undefined) ?? {}).reduce(
        (s, n) => s + (typeof n === "number" ? n : 0),
        0
      ),
      link: `${instance}/trips/${t.id as string}`,
    }));
    const total = typeof res.total === "number" ? res.total : null;
    const next =
      total !== null && offset + trips.length < total ? encodeCursor(offset + trips.length) : null;
    return {
      summary: `${trips.length} of ${total ?? "?"} trip(s).`,
      data: { trips, total, nextCursor: next, serverTruncated: res.truncated ?? false },
    };
  },
};

const get_trip_summary: ToolDef = {
  name: "get_trip_summary",
  title: "Trip summary",
  description:
    "One trip with its stops and routes. Counts come from the server; nothing is derived here.",
  wraps: [
    {
      method: "GET",
      path: "/trips/{id}",
      fields: [
        "trip.id",
        "trip.name",
        "trip.startDay",
        "trip.endDay",
        "trip.startZone",
        "trip.endZone",
        "trip.status",
        "trip.summary",
        "trip.summarySource",
        "trip.countries",
        "trip.provenance",
        "trip.rememberedOn",
        "trip.rememberedNote",
        "trip._count",
        "trip.stops[].title",
        "trip.stops[].domain",
        "trip.stops[].startDate",
        "trip.stops[].endDate",
        "trip.stops[].overnight",
      ],
    },
    {
      method: "GET",
      path: "/trips/{id}/routes",
      fields: [
        "routes[].id",
        "routes[].name",
        "routes[].mode",
        "routes[].kind",
        "routes[].distanceKm",
        "routes[].drivenKm",
        "routes[].stopCount",
      ],
    },
  ],
  input: { tripId: z.string().min(1).max(100) },
  async run({ client, instance }, a) {
    const id = encodeURIComponent(a.tripId as string);
    const [tripRes, routes] = await Promise.all([
      client.get<Rec>(`/trips/${id}`),
      client.get<Rec>(`/trips/${id}/routes`),
    ]);
    const trip = tripRes.trip as Rec;
    return {
      summary: `Trip "${(trip.name as string | null) ?? "(unnamed)"}", ${trip.startDay ?? "?"} to ${trip.endDay ?? "?"}.`,
      data: {
        trip: {
          ...pick(trip, [
            "id",
            "name",
            "status",
            "startDay",
            "endDay",
            "startZone",
            "endZone",
            "countries",
            "summary",
            "summarySource",
            "provenance",
            "rememberedOn",
            "rememberedNote",
          ]),
          counts: trip._count ?? null,
          link: `${instance}/trips/${trip.id as string}`,
        },
        stops: arr(trip.stops).map((s) =>
          pick(s, ["title", "domain", "startDate", "endDate", "overnight"])
        ),
        routes: arr(routes.routes).map((r) =>
          pick(r, ["id", "name", "mode", "kind", "distanceKm", "drivenKm", "stopCount"])
        ),
      },
    };
  },
};

const get_stats: ToolDef = {
  name: "get_stats",
  title: "Statistics",
  description:
    "The server's own figures, verbatim: `summary`, `countries` or `timeseries` (flight or cruise). `onlyRecorded` is passed through and echoed. The result names which purposes the user hides.",
  wraps: [
    { method: "GET", path: "/stats/summary", query: ["year", "onlyRecorded"] },
    {
      method: "GET",
      path: "/stats/countries",
      query: ["onlyRecorded"],
      fields: ["countries[].country", "countries[].count", "total"],
    },
    {
      method: "GET",
      path: "/stats/timeseries",
      query: ["domain", "granularity", "window", "year", "onlyRecorded"],
      fields: ["series[].period", "series[].count", "window", "scope"],
    },
    { method: "GET", path: "/purpose/visibility", fields: ["data.visibility", "data.revision"] },
  ],
  input: {
    view: z.enum(["summary", "countries", "timeseries"]),
    year: z.number().int().min(1950).max(2100).optional(),
    onlyRecorded: z.boolean().optional(),
    domain: z.enum(["flight", "cruise"]).default("flight"),
    granularity: z.enum(["month", "year"]).optional(),
    window: z.enum(["rolling12m", "year", "all"]).optional(),
  },
  async run({ client }, a) {
    const only = a.onlyRecorded as boolean | undefined;
    const year = a.year as number | undefined;
    const view = a.view as string;
    const [figures, vis] = await Promise.all([
      view === "summary"
        ? client.get<Rec>("/stats/summary", { year, onlyRecorded: only })
        : view === "countries"
          ? client.get<Rec>("/stats/countries", { onlyRecorded: only })
          : client.get<Rec>("/stats/timeseries", {
              domain: a.domain as string,
              granularity: a.granularity as string | undefined,
              window: a.window as string | undefined,
              year,
              onlyRecorded: only,
            }),
      client.get<{ data: Rec }>("/purpose/visibility"),
    ]);
    return {
      summary: `Stats (${view})${year ? ` for ${year}` : ""}${only ? ", recorded entries only" : ""}.`,
      data: {
        view,
        onlyRecorded: only ?? false,
        figures,
        purposeVisibility: vis.data.visibility,
        purposeVisibilityNote:
          "Entries of a hidden purpose are already left out of the figures by the server.",
      },
    };
  },
};

const get_upcoming: ToolDef = {
  name: "get_upcoming",
  title: "Upcoming",
  description: "The next entries across domains, in the order the server returns them.",
  wraps: [
    {
      method: "GET",
      path: "/upcoming",
      fields: [
        "data.entries[].domain",
        "data.entries[].id",
        "data.entries[].startsAt",
        "data.entries[].startsAtPrecision",
        "data.entries[].tripId",
        "data.entries[].tripName",
        "data.entries[].primary",
        "data.entries[].secondary",
      ],
    },
  ],
  input: { limit: z.number().int().min(1).max(50).default(15) },
  async run({ client, instance }, a) {
    const res = await client.get<{ data: Rec }>("/upcoming");
    const all = arr(res.data.entries);
    const entries = all.slice(0, a.limit as number).map((e) => ({
      ...pick(e, [
        "domain",
        "id",
        "startsAt",
        "startsAtPrecision",
        "tripId",
        "tripName",
        "primary",
        "secondary",
      ]),
      link: e.tripId ? `${instance}/trips/${e.tripId as string}` : null,
    }));
    return {
      summary: `${entries.length} of ${all.length} upcoming entr${all.length === 1 ? "y" : "ies"}.`,
      data: { entries, total: all.length },
    };
  },
};

const get_travtrack_day: ToolDef = {
  name: "get_travtrack_day",
  title: "TravTrack day summary",
  description:
    "A day's stays, moves and context from the user's location history, as a summary. Raw location points are never returned.",
  wraps: [
    {
      method: "GET",
      path: "/travtrack/day",
      query: ["date"],
      fields: [
        "date",
        "zone",
        "legs[].mode",
        "legs[].fromMs",
        "legs[].untilMs",
        "legs[].distanceM",
        "legs[].durationMs",
        "legs[].entryRef",
        "stops[].fromMs",
        "stops[].untilMs",
        "stops[].place",
        "context[].kind",
        "context[].label",
        "context[].fromMs",
        "context[].untilMs",
        "coverage[].state",
        "coverage[].fromMs",
        "coverage[].untilMs",
        "pointCount",
        "truncated",
        "omitted",
      ],
    },
  ],
  input: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD") },
  async run({ client }, a) {
    const d = await client.get<Rec>("/travtrack/day", { date: a.date as string });
    const range = (o: Rec) => ({ from: iso(o.fromMs), until: iso(o.untilMs) });
    return {
      summary: `${a.date as string} (${d.zone as string}): ${arr(d.stops).length} stay(s), ${arr(d.legs).length} move(s), ${d.pointCount as number} recorded point(s).`,
      data: {
        date: d.date,
        zone: d.zone,
        moves: arr(d.legs).map((l) => ({
          ...range(l),
          mode: l.mode,
          distanceM: l.distanceM,
          durationMs: l.durationMs,
          entry: l.entryRef ?? null,
        })),
        stays: arr(d.stops).map((s) => ({
          ...range(s),
          place: s.place
            ? { name: (s.place as Rec).name ?? null, source: (s.place as Rec).source ?? null }
            : null,
        })),
        context: arr(d.context).map((c) => ({ ...range(c), kind: c.kind, label: c.label })),
        coverage: arr(d.coverage).map((c) => ({ ...range(c), state: c.state })),
        pointCount: d.pointCount,
        serverTruncated: d.truncated,
        omitted: d.omitted,
      },
    };
  },
};

const INBOX_KINDS = [
  "trip_suggestions",
  "location_suggestions",
  "data_quality",
  "pending_updates",
  "provenance_notices",
] as const;

const list_inbox: ToolDef = {
  name: "list_inbox",
  title: "Inbox",
  description:
    "Open items the server wants the user to look at. A source that fails is reported as its own error, never left out silently.",
  wraps: [
    {
      method: "GET",
      path: "/trip-suggestions",
      fields: [
        "data.suggestions[].id",
        "data.suggestions[].kind",
        "data.suggestions[].startDay",
        "data.suggestions[].endDay",
        "data.suggestions[].destination",
        "data.suggestions[].signals",
        "data.disabled",
      ],
    },
    {
      method: "GET",
      path: "/location-suggestions",
      query: ["status"],
      fields: ["data[].id", "data[].kind", "data[].explanation", "data[].window"],
    },
    {
      method: "GET",
      path: "/data-quality-flags",
      query: ["status"],
      fields: [
        "flags[].id",
        "flags[].kind",
        "flags[].entityType",
        "flags[].entityId",
        "flags[].createdAt",
      ],
    },
    {
      method: "GET",
      path: "/pending-updates",
      query: ["status"],
      fields: ["updates[].id", "updates[].flightId", "updates[].status", "updates[].createdAt"],
    },
    {
      method: "GET",
      path: "/provenance/notices",
      fields: [
        "data.notices[].id",
        "data.notices[].kind",
        "data.notices[].entryType",
        "data.notices[].entryId",
        "data.notices[].createdAt",
      ],
    },
  ],
  input: {
    kinds: z.array(z.enum(INBOX_KINDS)).optional(),
    limit: z.number().int().min(1).max(25).default(10),
  },
  async run({ client }, a) {
    const kinds = (a.kinds as string[] | undefined) ?? [...INBOX_KINDS];
    const limit = a.limit as number;
    const sources: Record<string, () => Promise<{ items: Rec[]; total: number; why?: string }>> = {
      trip_suggestions: async () => {
        const r = await client.get<{ data: Rec }>("/trip-suggestions");
        if (r.data.disabled)
          return {
            items: [],
            total: 0,
            why: "Trip suggestions are switched off for this account.",
          };
        const l = arr(r.data.suggestions);
        return {
          total: l.length,
          items: l.map((s) => ({
            id: s.id,
            title: `${s.kind as string} ${s.startDay as string} to ${s.endDay as string}${s.destination ? ` (${s.destination as string})` : ""}`,
            why: `signals: ${(arr(s.signals) as unknown as string[]).join(", ") || "none"}`,
            createdAt: null,
          })),
        };
      },
      location_suggestions: async () => {
        const r = await client.get<{ data: Rec[] }>("/location-suggestions", { status: "pending" });
        return {
          total: r.data.length,
          items: r.data.map((s) => ({
            id: s.id,
            title: `${s.kind as string} suggestion`,
            why: (s.explanation as Rec).code,
            createdAt: iso((s.window as Rec).fromMs),
          })),
        };
      },
      data_quality: async () => {
        const r = await client.get<Rec>("/data-quality-flags", { status: "open" });
        const l = arr(r.flags);
        return {
          total: l.length,
          items: l.map((f) => ({
            id: f.id,
            title: `${f.kind as string} on ${f.entityType as string} ${f.entityId as string}`,
            why: f.kind,
            createdAt: f.createdAt,
          })),
        };
      },
      pending_updates: async () => {
        const r = await client.get<Rec>("/pending-updates", { status: "pending" });
        const l = arr(r.updates);
        return {
          total: l.length,
          items: l.map((u) => ({
            id: u.id,
            title: `pending update${u.flightId ? ` for flight ${u.flightId as string}` : ""}`,
            why: u.status ?? null,
            createdAt: u.createdAt ?? null,
          })),
        };
      },
      provenance_notices: async () => {
        const r = await client.get<{ data: Rec }>("/provenance/notices");
        const l = arr(r.data.notices);
        return {
          total: l.length,
          items: l.map((n) => ({
            id: n.id,
            title: `${n.entryType as string} ${n.entryId as string}`,
            why: n.kind,
            createdAt: n.createdAt,
          })),
        };
      },
    };
    const settled = await Promise.allSettled(kinds.map((k) => sources[k]()));
    const items: Rec[] = [];
    const totals: Record<string, number> = {};
    const errors: Rec[] = [];
    const notes: Rec[] = [];
    settled.forEach((s, i) => {
      const kind = kinds[i];
      if (s.status === "fulfilled") {
        totals[kind] = s.value.total;
        if (s.value.why) notes.push({ kind, note: s.value.why });
        items.push(...s.value.items.slice(0, limit).map((it) => ({ kind, ...it })));
      } else {
        const e = s.reason as { reason?: string; message?: string };
        errors.push({ kind, reason: e.reason ?? "server", message: e.message ?? "failed" });
      }
    });
    return {
      summary: `${items.length} inbox item(s)${errors.length ? `; ${errors.length} source(s) failed: ${errors.map((e) => e.kind).join(", ")}` : ""}.`,
      data: { items, totals, errors, notes },
    };
  },
};

const get_readiness: ToolDef = {
  name: "get_readiness",
  title: "Readiness",
  description: "Setup items that need the user's attention (missing configuration, update notes).",
  wraps: [
    {
      method: "GET",
      path: "/readiness",
      fields: [
        "summary",
        "items[].id",
        "items[].severity",
        "items[].status",
        "items[].titleKey",
        "items[].action",
        "items[].blockedBy",
      ],
    },
  ],
  input: {},
  async run({ client, instance }) {
    const r = await client.get<Rec>("/readiness");
    const items = arr(r.items)
      .filter((i) => i.status !== "ready")
      .map((i) => ({
        ...pick(i, ["id", "severity", "status", "titleKey", "action", "blockedBy"]),
        link:
          typeof i.action === "string" && i.action.startsWith("/")
            ? `${instance}${i.action}`
            : null,
      }));
    return {
      summary: `${items.length} item(s) need attention.`,
      data: { items, summary: r.summary },
    };
  },
};

const get_routing_run: ToolDef = {
  name: "get_routing_run",
  title: "Routing run",
  description: "Progress of a routing run by its id.",
  wraps: [
    {
      method: "GET",
      path: "/routing-runs/{id}",
      fields: [
        "run.status",
        "run.total",
        "run.processed",
        "run.routed",
        "run.kept",
        "run.failureCounts",
        "run.failureSample",
        "run.stopReason",
      ],
    },
  ],
  input: { runId: z.string().min(1).max(100) },
  async run({ client }, a) {
    const { run } = await client.get<{ run: Rec }>(
      `/routing-runs/${encodeURIComponent(a.runId as string)}`
    );
    return {
      summary: `Run ${run.status as string}: ${run.processed as number} of ${run.total as number}.`,
      data: {
        status: run.status,
        done: run.processed,
        total: run.total,
        routed: run.routed,
        kept: run.kept,
        failureCounts: run.failureCounts,
        failures: run.failureSample,
        stopReason: run.stopReason ?? null,
      },
    };
  },
};

export const TOOLS: ToolDef[] = [
  search_entries,
  list_trips,
  get_trip_summary,
  get_stats,
  get_upcoming,
  get_travtrack_day,
  list_inbox,
  get_readiness,
  get_routing_run,
];
export type { ToolResult };
