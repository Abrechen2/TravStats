import { z } from "zod";
import { registry } from "../registry";
import { errorContent } from "./shared";

const tags = ["Places"];
const uuid = z.string().uuid();
const notFound = { description: "Not found", content: errorContent };
const badInput = { description: "Invalid input", content: errorContent };
const envelope = (schema: z.ZodTypeAny, description = "Account-scoped result") => ({
  description,
  content: { "application/json": { schema: z.object({ success: z.literal(true), data: schema }) } },
});

const brand = z.object({ brandWikidataId: z.string(), brandName: z.string() });
const settings = z.object({
  minDwellMinutes: z.number().int(),
  maxDwellMinutes: z.number().int(),
  maxDistanceM: z.number().int().describe("Suggestion tier (default 100 m)"),
  autoAcceptDistanceM: z
    .number()
    .int()
    .describe("Auto-accept tier (default 60 m), at most maxDistanceM"),
  autoAccept: z.boolean(),
});
const rule = z.object({ listId: uuid, brands: z.array(brand) }).merge(settings);
const ruleInput = z.object({ brands: z.array(brand).min(1).max(10) }).merge(settings);

const suggestion = z.object({
  id: uuid,
  placeId: uuid.nullable(),
  name: z.string().nullable(),
  startAt: z.string(),
  endAt: z.string(),
  startLocal: z.string(),
  endLocal: z.string(),
  zone: z.string(),
  durationMinutes: z.number().int(),
  distanceM: z.number().nullable(),
  source: z.literal("travtrack"),
  strength: z.enum(["id", "name"]),
  lists: z.array(z.object({ listId: uuid, listName: z.string() })),
  lat: z.number(),
  lon: z.number(),
});

const SMART =
  "A smart list follows a chain (docs/superpowers/specs/2026-11-22-brand-lists.md): a TravTrack stop at one of its outlets becomes ONE visit suggestion, shown in the stay inbox and on the outlet's place page.";

registry.registerPath({
  method: "get",
  path: "/place-lists/smart/brands",
  summary: "Search chains by name (Wikidata)",
  description:
    "Brand ids are chosen from this search, never typed. Goes through the open-data service: 409 `OPEN_DATA_DISABLED` while it is off, 504 `UPSTREAM_TIMEOUT`, 503 `UPSTREAM_RATE_LIMITED`, 502 `UPSTREAM_UNAVAILABLE`. An empty list means Wikidata answered with nothing.",
  tags,
  request: {
    query: z.object({ q: z.string().min(1).max(80), lang: z.enum(["de", "en"]).optional() }),
  },
  responses: {
    200: envelope(
      z.array(z.object({ id: z.string(), label: z.string(), description: z.string().nullable() }))
    ),
    409: { description: "Open data switched off", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/place-lists/smart/{listId}/rule",
  summary: "The chain rule of a list (null: an ordinary list)",
  description: SMART,
  tags,
  request: { params: z.object({ listId: uuid }) },
  responses: { 200: envelope(rule.nullable()), 404: notFound },
});

registry.registerPath({
  method: "put",
  path: "/place-lists/smart/{listId}/rule",
  summary: "Make a list follow one or more chains, or change its rule",
  description: `${SMART} Dwell window, maximum distance and \`autoAccept\` (off by default) apply to every brand of the list. A shipped checklist answers 409 \`LIST_IS_CURATED\`.`,
  tags,
  request: {
    params: z.object({ listId: uuid }),
    body: { content: { "application/json": { schema: ruleInput } }, required: true },
  },
  responses: { 200: envelope(rule), 400: badInput, 404: notFound },
});

registry.registerPath({
  method: "delete",
  path: "/place-lists/smart/{listId}/rule",
  summary: "Stop following chains; the list keeps its places",
  tags,
  request: { params: z.object({ listId: uuid }) },
  responses: { 200: envelope(z.null()), 404: notFound },
});

registry.registerPath({
  method: "get",
  path: "/place-lists/smart/{listId}/suggestions",
  summary: "New outlets TravTrack matched to this list (not yet one of your places)",
  description:
    "Pending suggestions: answer them through `POST /dawarich-stays/{id}/accept` or `/reject`; the inbox shows the same row.",
  tags,
  request: { params: z.object({ listId: uuid }) },
  responses: { 200: envelope(z.array(suggestion)), 404: notFound },
});

registry.registerPath({
  method: "get",
  path: "/place-lists/smart/{listId}/auto",
  summary: "Recently taken automatically",
  description: "Up to 20 matches the list took without asking, newest first; each can be undone.",
  tags,
  request: { params: z.object({ listId: uuid }) },
  responses: { 200: envelope(z.array(suggestion)), 404: notFound },
});

registry.registerPath({
  method: "post",
  path: "/place-lists/smart/auto/{stayId}/undo",
  summary: "Undo one automatic acceptance",
  description:
    "Removes only what the automation wrote (marked `brandRule`): never a place, list entry or visit the owner had, and a visit that gained a note or rating is kept (`keptVisit`). The finding is marked rejected and does not return. 404 `AUTO_ENTRY_NOT_FOUND`, 409 `NOT_AUTOMATIC`.",
  tags,
  request: { params: z.object({ stayId: uuid }) },
  responses: {
    200: envelope(
      z.object({
        removedVisit: z.boolean(),
        removedEntries: z.number().int(),
        removedPlace: z.boolean(),
        keptVisit: z.enum(["notes", "notAutomatic"]).nullable(),
      })
    ),
    404: notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/place-lists/smart/place/{placeId}/suggestions",
  summary: "“Were you here?” suggestions for a place",
  description:
    "Pending TravTrack visit findings of this place: the same rows the stay inbox lists. Answering one (accept or reject through the stays API) answers both.",
  tags,
  request: { params: z.object({ placeId: uuid }) },
  responses: { 200: envelope(z.array(suggestion)), 404: notFound },
});

const memberRow = z.object({
  entryId: uuid,
  placeId: uuid,
  name: z.string(),
  category: z.string(),
  country: z.string().nullable(),
  countryCode: z.string().nullable(),
  city: z.string().nullable(),
  visitCount: z.number().int().describe("Past visits (a planned one is not counted)"),
  firstVisit: z.string().nullable().describe("Local day, YYYY-MM-DD"),
  lastVisit: z.string().nullable().describe("Local day, YYYY-MM-DD"),
  addedAt: z.string(),
  sortIdx: z.number().int(),
  source: z.enum(["manual", "rule", "import", "plugin"]),
  distanceKm: z.number().nullable().describe("From the account's home; null without one"),
  external: z
    .object({
      id: z.string(),
      label: z.string().optional(),
      fields: z.record(z.string(), z.string()),
    })
    .nullable()
    .describe("A plugin-fed list's reference and its announced columns"),
  visits: z
    .array(z.object({ id: uuid, date: z.string().nullable() }))
    .describe("Past visits, newest first, at most 50"),
});

registry.registerPath({
  method: "get",
  path: "/place-lists/{id}/members",
  summary: "One page of a list as a table",
  description:
    "Sorted and paged on the server. Every sort ends in name, then entry id; a missing value sorts last in both directions. Takes `?purposeFilter=` like every entry read.",
  tags,
  request: {
    params: z.object({ id: uuid }),
    query: z.object({
      sort: z
        .enum([
          "lastVisit",
          "firstVisit",
          "name",
          "country",
          "visitCount",
          "addedAt",
          "distance",
          "custom",
        ])
        .optional(),
      order: z.enum(["asc", "desc"]).optional(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(100).optional(),
      q: z.string().max(100).optional(),
    }),
  },
  responses: {
    200: envelope(
      z.object({
        rows: z.array(memberRow),
        total: z.number().int(),
        page: z.number().int(),
        pageSize: z.number().int(),
        columns: z.array(
          z.object({ key: z.string(), label: z.object({ de: z.string(), en: z.string() }) })
        ),
        hasHome: z.boolean(),
      })
    ),
    400: badInput,
    404: notFound,
  },
});
