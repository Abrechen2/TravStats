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
  maxDistanceM: z.number().int(),
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
