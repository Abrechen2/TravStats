/**
 * The calendar subscription (forgejo#310): the owner's side
 * (`routes/calendarFeed.ts`, enveloped) and the URL a calendar app reads
 * (`routes/calendarFeedPublic.ts`, an iCalendar body).
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  CALENDAR_FEED_LOOKBACK_DAYS,
  CALENDAR_FEED_REFRESH_MINUTES,
} from "../../calendarFeed/feedService";

const tags = ["Calendar feed"];
const err = (description: string) => ({ description, content: errorContent });
const ok = (description: string, data: z.ZodTypeAny) => ({
  description,
  content: {
    "application/json": { schema: z.object({ success: z.literal(true), data }) },
  },
});

const sessionOnly = err(
  "An API token: the URL is a credential, managed from a browser session only; or the shared demo account"
);

registry.registerPath({
  method: "get",
  path: "/calendar-feed",
  summary: "Whether the caller has a calendar subscription URL",
  description:
    "The URL itself is not listed — only its hash is stored, so it is shown once, when it is " +
    "made. `enabled` is the instance's beta switch: no URL is issued, and none answers, while " +
    "it is off.",
  tags,
  responses: {
    200: ok(
      "The caller's subscription state",
      z.object({
        enabled: z.boolean(),
        active: z.boolean(),
        createdAt: z.string().datetime().nullable(),
        lastUsedAt: z
          .string()
          .datetime()
          .nullable()
          .describe("When a calendar app last read the URL; null when never"),
      })
    ),
    403: sessionOnly,
  },
});

registry.registerPath({
  method: "post",
  path: "/calendar-feed",
  summary: "Issue a new calendar subscription URL",
  description:
    "Returns the URL ONCE, as `https:` and as `webcal:`. A previous URL of the caller stops " +
    "answering in the same write. Limited to 20 an hour per user.",
  tags,
  responses: {
    201: ok(
      "The new URL",
      z.object({
        url: z.string().describe("`<public base>/api/v1/calendar/<token>.ics` — shown once"),
        webcalUrl: z.string().describe("The same address under `webcal://`"),
        createdAt: z.string().datetime(),
      })
    ),
    403: sessionOnly,
    409: err("`CALENDAR_FEED_DISABLED`: the instance's beta switch is off"),
    429: err("Too many new URLs this hour"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/calendar-feed",
  summary: "Revoke the calendar subscription URL",
  description: "The URL answers 404 from this request on. Allowed whatever the beta switch says.",
  tags,
  responses: {
    200: ok("Revoked", z.object({ revoked: z.boolean().describe("False: there was no URL") })),
    403: sessionOnly,
  },
});

registry.registerPath({
  method: "get",
  path: "/calendar/{feed}",
  summary: "The calendar subscription itself (no session, the token is the permission)",
  description:
    "`feed` is `<token>.ics`. An RFC 5545 calendar of the token owner's entries in every domain " +
    "they see (their switches and the instance's beta switch) plus their trips, from " +
    `${CALENDAR_FEED_LOOKBACK_DAYS} days back onwards; cancelled entries are left out. One ` +
    "event per entry with a stable UID. Timed entries are UTC instants; entries known by day " +
    "only (stays without hours, cruises, trips, roadtrip stations, date-only rides) are all-day " +
    "events on the place's calendar day; anything vaguer is left out. Answers " +
    "`Cache-Control: private`, asks clients to poll every " +
    `${CALENDAR_FEED_REFRESH_MINUTES} minutes, and is limited to 120 reads an hour per URL.`,
  tags,
  security: [],
  request: { params: z.object({ feed: z.string().describe("`<token>.ics`") }) },
  responses: {
    200: {
      description: "The calendar",
      content: { "text/calendar": { schema: z.string() } },
    },
    404: err(
      "`CALENDAR_FEED_NOT_FOUND` — the one answer for every failure: malformed, unknown, " +
        "revoked, the beta switch off. A guesser learns nothing about whether a token existed."
    ),
    429: err("Too many reads of this URL, or too many unknown URLs from this address"),
  },
});
