import { z } from "./zod";

/** Calendar sources of an account (spec 2026-11-23-plugins-and-calendar.md, Part A). */
export const MAX_CALENDAR_SOURCES = 10;

const label = z.string().trim().min(1).max(60);
const url = z.string().trim().min(1).max(2000);
const collection = z
  .object({ href: z.string().trim().min(1).max(2000), name: z.string().trim().max(120) })
  .strict();

export const calendarSourceCreateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ics"), label, icsUrl: url }).strict(),
  z
    .object({
      kind: z.literal("caldav"),
      label,
      url,
      username: z.string().trim().min(1).max(200),
      password: z.string().min(1).max(500),
      collections: z.array(collection).min(1).max(20),
    })
    .strict(),
]);
export type CalendarSourceCreate = z.infer<typeof calendarSourceCreateSchema>;

export const calendarSourceUpdateSchema = z
  .object({
    label: label.optional(),
    enabled: z.boolean().optional(),
    icsUrl: url.optional(),
    url: url.optional(),
    username: z.string().trim().min(1).max(200).optional(),
    password: z.string().min(1).max(500).optional(),
    collections: z.array(collection).min(1).max(20).optional(),
  })
  .strict();
export type CalendarSourceUpdate = z.infer<typeof calendarSourceUpdateSchema>;

/** Discovery and the unsaved test name a server the account types in. */
export const caldavDiscoverSchema = z
  .object({
    url,
    username: z.string().trim().min(1).max(200),
    password: z.string().min(1).max(500),
  })
  .strict();

export const calendarSourceViewSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["ics", "caldav"]),
  enabled: z.boolean(),
  /** ICS: only the host of the secret address; the address itself never comes back. */
  icsHost: z.string().nullable(),
  caldavUrl: z.string().nullable(),
  caldavUsername: z.string().nullable(),
  /** Whether the secret part (ICS address, CalDAV password) is stored. */
  credentialSet: z.boolean(),
  collections: z.array(z.object({ href: z.string(), name: z.string() })),
  lastStatus: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  lastCheckedAt: z.string().nullable(),
});
export type CalendarSourceView = z.infer<typeof calendarSourceViewSchema>;

export const calendarTestResultSchema = z.object({
  ok: z.literal(true),
  /** Events inside the tested window. */
  events: z.number().int(),
  from: z.string(),
  to: z.string(),
  /** Recurring events cut short by a cap (their later occurrences are missing). */
  skippedRules: z.number().int(),
});
