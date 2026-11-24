/**
 * Calendar sources (spec 2026-11-23-plugins-and-calendar.md, Part A): an
 * account's ICS subscriptions and CalDAV collections, read only as evidence
 * for its TravTrack stops. Secrets never come back: the ICS address is answered
 * by its host, the CalDAV password by `credentialSet`.
 */
import { z } from "zod";
import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  caldavDiscoverSchema,
  calendarSourceCreateSchema,
  calendarSourceUpdateSchema,
  calendarSourceViewSchema,
  calendarTestResultSchema,
} from "../../../schemas/calendarSources";
import { calendarRuleViewSchema, calendarRulesPutSchema } from "../../calendar/rules";

const tags = ["Settings"];
const json = <T extends z.ZodTypeAny>(schema: T) => ({ "application/json": { schema } });
const failed = {
  description:
    "Failed, with a fixed kind in `error` — notConfigured, unreachable, auth, notFound, " +
    "protocol or invalidUrl — and the case in `code` (PRIVATE_TARGET, CALENDAR_TOO_LARGE, …).",
  content: errorContent,
};
const idParam = z.object({ id: z.string().uuid() });

registry.registerPath({
  method: "get",
  path: "/settings/calendar-sources",
  summary: "List the calendar sources",
  description:
    "`blocked` says whether reading is switched off on this server (`internet_off`, `service_off`).",
  tags,
  responses: {
    200: {
      description: "Sources",
      content: json(
        z.object({
          sources: z.array(calendarSourceViewSchema),
          blocked: z.enum(["internet_off", "service_off"]).nullable(),
          geocodeLocations: z.boolean(),
        })
      ),
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/settings/calendar-sources",
  summary: "Add a calendar source",
  description:
    "An ordinary account's address must be public (forgejo#411); only an admin's own may " +
    "name a LAN server. At most 10 sources (CALENDAR_SOURCE_LIMIT).",
  tags,
  request: { body: { content: json(calendarSourceCreateSchema) } },
  responses: {
    201: { description: "Added", content: json(calendarSourceViewSchema) },
    400: failed,
    409: { description: "Limit reached", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/settings/calendar-sources/{id}",
  summary: "Change a calendar source",
  tags,
  request: { params: idParam, body: { content: json(calendarSourceUpdateSchema) } },
  responses: {
    200: { description: "Changed", content: json(calendarSourceViewSchema) },
    400: failed,
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/settings/calendar-sources/{id}",
  summary: "Remove a calendar source",
  description: "Its matched evidence on open findings goes with it.",
  tags,
  request: { params: idParam },
  responses: {
    204: { description: "Removed" },
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/settings/calendar-sources/{id}/test",
  summary: "Read a calendar source once",
  description: "Reads the 30 days before and after now and counts the events; nothing is kept.",
  tags,
  request: { params: idParam },
  responses: {
    200: { description: "Read", content: json(calendarTestResultSchema) },
    400: failed,
    429: { description: "Too many tests", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/settings/calendar-sources/caldav/discover",
  summary: "List the calendars of a CalDAV account",
  tags,
  request: { body: { content: json(caldavDiscoverSchema) } },
  responses: {
    200: {
      description: "Calendars",
      content: json(
        z.object({ collections: z.array(z.object({ href: z.string(), name: z.string() })) })
      ),
    },
    400: failed,
    429: { description: "Too many tests", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/settings/calendar-sources/rules",
  summary: "List the calendar rules",
  description: "Ordered; the first rule that matches an event decides its purpose and name.",
  tags,
  responses: {
    200: {
      description: "Rules",
      content: json(z.object({ rules: z.array(calendarRuleViewSchema) })),
    },
  },
});

registry.registerPath({
  method: "put",
  path: "/settings/calendar-sources/rules",
  summary: "Replace the calendar rules",
  description:
    "The whole ordered list (at most 50, CALENDAR_RULE_LIMIT). A calendar rule names a source; " +
    "a keyword rule a token matched at word boundaries, optionally an own place.",
  tags,
  request: { body: { content: json(calendarRulesPutSchema) } },
  responses: {
    200: {
      description: "Saved",
      content: json(z.object({ rules: z.array(calendarRuleViewSchema) })),
    },
    400: { description: "Invalid", content: errorContent },
    404: { description: "Source or place not found", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/settings/calendar-sources/preferences",
  summary: "Whether event locations may be looked up in the geocoder",
  description:
    "Off by default: an event location is personal text. Without it an event still matches a " +
    "stop by an own place's or the venue's name, or by a rule's place.",
  tags,
  request: { body: { content: json(z.object({ geocodeLocations: z.boolean() })) } },
  responses: {
    200: { description: "Saved", content: json(z.object({ geocodeLocations: z.boolean() })) },
    400: { description: "Invalid", content: errorContent },
  },
});
