/**
 * An account's calendar sources: stored, shown and read (spec
 * 2026-11-23-plugins-and-calendar.md, Part A).
 *
 * The ICS subscription address is the credential (anyone holding it reads the
 * calendar), so it is stored encrypted like an API key and only its host is
 * ever shown again; the CalDAV password the same. Every read goes through the
 * catalogue gate (`calendar`: the internet master switch and the admin's
 * switch) and the forgejo#411 rule: an ordinary account reaches public
 * addresses only — checked on save, on test and on every fetch, DNS pinned —
 * and an admin's own source may name a LAN server (Radicale, Nextcloud).
 */
import { prisma } from "../../db";
import type { CalendarSource } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import { decryptApiKey, encryptApiKey } from "../../utils/encryption";
import { assertEgressAllowed } from "../externalServices/egress";
import {
  PrivateTargetError,
  accountMayReachPrivate,
  assertTargetAllowed,
  plainHttpAllowed,
  type TargetPolicy,
} from "../egress/privateTargets";
import { boundedFetch, type FetchLike } from "../egress/boundedFetch";
import {
  MAX_CALENDAR_SOURCES,
  type CalendarSourceCreate,
  type CalendarSourceUpdate,
  type CalendarSourceView,
} from "../../schemas/calendarSources";
import { MAX_EVENTS_PER_FILE, type ParsedWindow } from "./icsParse";
import { parseIcsInWorker } from "./icsWorker";
import {
  CALDAV_TIMEOUT_MS,
  queryCollection,
  type CaldavCollection,
  type CaldavCredentials,
} from "./caldav";
import { CalendarError, calendarErrorOfStatus, toCalendarError } from "./errors";

export const CALENDAR_SERVICE_ID = "calendar";
export const ICS_MAX_BYTES = 5 * 1024 * 1024;
export const ICS_TIMEOUT_MS = 20_000;
/**
 * One read (all fetches and the parse) under ONE absolute deadline, and one
 * event budget shared by every text it brings back (security review): twenty
 * collections must not mean twenty deadlines and twenty budgets.
 */
export const READ_DEADLINE_MS = 60_000;

export interface CalendarWindow {
  fromMs: number;
  untilMs: number;
}

export interface CalendarReadDeps {
  fetch?: FetchLike;
  /** Absolute deadline of the read (epoch ms); default now + READ_DEADLINE_MS. */
  deadlineAt?: number;
  /** Test seam: the total events allowed across the read. */
  maxEvents?: number;
}

const remaining = (deadlineAt: number, cap: number): number => {
  const left = deadlineAt - Date.now();
  if (left <= 0) throw new CalendarError("unreachable", "CALENDAR_TIMEOUT");
  return Math.min(cap, left);
};

/**
 * `webcal://` is the subscription scheme of the same https address. Plain http
 * only for an admin's own LAN server: anywhere else the secret ICS address and
 * the CalDAV password would cross the internet readable (review, P1).
 */
export function normaliseCalendarUrl(raw: string, policy: TargetPolicy): string {
  const trimmed = raw.trim().replace(/^webcals?:\/\//i, "https://");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AppError("invalidUrl", 400);
  }
  if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password)
    throw new AppError("invalidUrl", 400);
  try {
    assertTargetAllowed(parsed.toString(), policy);
  } catch (error) {
    if (error instanceof PrivateTargetError)
      throw new AppError("invalidUrl", 400, "PRIVATE_TARGET");
    throw error;
  }
  if (parsed.protocol === "http:" && !plainHttpAllowed(parsed.toString(), policy))
    throw new AppError("invalidUrl", 400, "CALENDAR_HTTPS_REQUIRED");
  return parsed.toString();
}

export async function policyFor(userId: string): Promise<TargetPolicy> {
  return { allowPrivate: await accountMayReachPrivate(userId) };
}

const collectionsOf = (v: unknown): CaldavCollection[] =>
  Array.isArray(v)
    ? v.flatMap((c) =>
        c && typeof c === "object" && typeof (c as CaldavCollection).href === "string"
          ? [
              {
                href: (c as CaldavCollection).href,
                name: String((c as CaldavCollection).name ?? ""),
              },
            ]
          : []
      )
    : [];

export function viewOf(row: CalendarSource): CalendarSourceView {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind === "caldav" ? "caldav" : "ics",
    enabled: row.enabled,
    icsHost: row.icsHost,
    caldavUrl: row.caldavUrl,
    caldavUsername: row.caldavUsername,
    credentialSet: Boolean(
      row.kind === "caldav" ? row.caldavPasswordEncrypted : row.icsUrlEncrypted
    ),
    collections: collectionsOf(row.caldavCollections),
    lastStatus: row.lastStatus,
    lastErrorCode: row.lastErrorCode,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
  };
}

export async function listSources(userId: string): Promise<CalendarSource[]> {
  return prisma.calendarSource.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

async function ownSource(userId: string, id: string): Promise<CalendarSource> {
  const row = await prisma.calendarSource.findFirst({ where: { id, userId } });
  if (!row) throw new AppError("Calendar source not found", 404);
  return row;
}

export async function createSource(
  userId: string,
  input: CalendarSourceCreate
): Promise<CalendarSource> {
  if ((await prisma.calendarSource.count({ where: { userId } })) >= MAX_CALENDAR_SOURCES)
    throw new AppError("Too many calendar sources", 409, "CALENDAR_SOURCE_LIMIT");
  const policy = await policyFor(userId);
  if (input.kind === "ics") {
    const url = normaliseCalendarUrl(input.icsUrl, policy);
    return prisma.calendarSource.create({
      data: {
        userId,
        label: input.label,
        kind: "ics",
        icsUrlEncrypted: encryptApiKey(url),
        icsHost: new URL(url).host,
      },
    });
  }
  const url = normaliseCalendarUrl(input.url, policy);
  return prisma.calendarSource.create({
    data: {
      userId,
      label: input.label,
      kind: "caldav",
      caldavUrl: url,
      caldavUsername: input.username,
      caldavPasswordEncrypted: encryptApiKey(input.password),
      caldavCollections: input.collections.map((c) => ({
        href: normaliseCalendarUrl(new URL(c.href, url).toString(), policy),
        name: c.name,
      })),
    },
  });
}

export async function updateSource(
  userId: string,
  id: string,
  input: CalendarSourceUpdate
): Promise<CalendarSource> {
  const row = await ownSource(userId, id);
  const policy = await policyFor(userId);
  const data: Record<string, unknown> = {};
  if (input.label !== undefined) data.label = input.label;
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (row.kind === "ics" && input.icsUrl !== undefined) {
    const url = normaliseCalendarUrl(input.icsUrl, policy);
    data.icsUrlEncrypted = encryptApiKey(url);
    data.icsHost = new URL(url).host;
  }
  if (row.kind === "caldav") {
    const base = input.url !== undefined ? normaliseCalendarUrl(input.url, policy) : row.caldavUrl!;
    if (input.url !== undefined) data.caldavUrl = base;
    if (input.username !== undefined) data.caldavUsername = input.username;
    if (input.password !== undefined) data.caldavPasswordEncrypted = encryptApiKey(input.password);
    if (input.collections !== undefined)
      data.caldavCollections = input.collections.map((c) => ({
        href: normaliseCalendarUrl(new URL(c.href, base).toString(), policy),
        name: c.name,
      }));
  }
  // Whatever changed, the last test said nothing about the new settings.
  if (Object.keys(data).some((k) => k !== "label" && k !== "enabled")) {
    data.lastStatus = null;
    data.lastErrorCode = null;
    data.lastCheckedAt = null;
  }
  return prisma.calendarSource.update({ where: { id: row.id }, data });
}

/**
 * Removing a source removes what it left on open findings (council, 2026-11-23):
 * a finding that exists only because of it goes, every other loses its
 * `evidence.calendar` and the purpose the calendar suggested, and every answered
 * one keeps no more than the event's span (the trigger already holds that; this
 * holds it for any row a past path left). Its rules go with it (cascade).
 */
export async function deleteSource(userId: string, id: string): Promise<void> {
  const row = await ownSource(userId, id);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      DELETE FROM dawarich_stays
       WHERE user_id = ${userId} AND status = 'pending'
         AND evidence->>'createdFrom' = 'calendar'
         AND evidence->'calendar'->>'sourceId' = ${row.id}`;
    await tx.$executeRaw`
      UPDATE dawarich_stays
         SET evidence = (evidence - 'calendar') -
             (CASE WHEN evidence->>'suggestedPurposeFrom' = 'calendar'
                   THEN ARRAY['suggestedPurpose', 'suggestedPurposeFrom']
                   ELSE ARRAY[]::text[] END)
       WHERE user_id = ${userId} AND status = 'pending'
         AND evidence->'calendar'->>'sourceId' = ${row.id}`;
    // Every other row of the source, whatever its status: nothing of the event's text stays.
    await tx.$executeRaw`
      UPDATE dawarich_stays
         SET evidence = jsonb_set(evidence, '{calendar}',
             (evidence->'calendar') - ARRAY['title', 'location', 'sourceLabel', 'proposedName',
                                            'geocoded', 'rule', 'allDay', 'match', 'timeMatch',
                                            'overlapMinutes'])
       WHERE user_id = ${userId}
         AND evidence->'calendar'->>'sourceId' = ${row.id}`;
    await tx.calendarSource.delete({ where: { id: row.id } });
  });
}

/** One ICS feed, whole (there is no other way), filtered to the window in memory. */
export async function readIcs(
  url: string,
  window: CalendarWindow,
  profileZone: string,
  policy: TargetPolicy,
  deps: CalendarReadDeps = {}
): Promise<ParsedWindow> {
  const deadlineAt = deps.deadlineAt ?? Date.now() + READ_DEADLINE_MS;
  const res = await boundedFetch(
    url,
    {
      headers: { Accept: "text/calendar, */*;q=0.5" },
      policy,
      timeoutMs: remaining(deadlineAt, ICS_TIMEOUT_MS),
      httpsOnly: !plainHttpAllowed(url, policy),
      maxBytes: ICS_MAX_BYTES,
    },
    deps.fetch
  );
  const failed = calendarErrorOfStatus(res.status);
  if (failed) throw failed;
  return parseIcsInWorker([res.body.toString("utf8")], {
    ...window,
    profileZone,
    deadlineAt,
    maxEvents: deps.maxEvents ?? MAX_EVENTS_PER_FILE,
  });
}

/** The chosen CalDAV collections, each asked for the window only (`time-range`). */
export async function readCaldav(
  creds: CaldavCredentials,
  collections: readonly CaldavCollection[],
  window: CalendarWindow,
  profileZone: string,
  policy: TargetPolicy,
  deps: CalendarReadDeps = {}
): Promise<ParsedWindow> {
  const deadlineAt = deps.deadlineAt ?? Date.now() + READ_DEADLINE_MS;
  const maxEvents = deps.maxEvents ?? MAX_EVENTS_PER_FILE;
  const texts: string[] = [];
  for (const c of collections) {
    const timeoutMs = remaining(deadlineAt, CALDAV_TIMEOUT_MS);
    texts.push(...(await queryCollection(creds, c.href, window, policy, deps.fetch, timeoutMs)));
    // Each text holds at least one event: more texts than the budget can never fit it.
    if (texts.length > maxEvents) throw new CalendarError("protocol", "CALENDAR_TOO_MANY_EVENTS");
  }
  return parseIcsInWorker(texts, { ...window, profileZone, deadlineAt, maxEvents });
}

/** A stored source, read for one window. Records the outcome on the row. */
export async function readSourceWindow(
  row: CalendarSource,
  window: CalendarWindow,
  profileZone: string,
  deps: CalendarReadDeps = {}
): Promise<ParsedWindow> {
  try {
    await assertEgressAllowed(CALENDAR_SERVICE_ID);
    // Read per request: a demoted admin loses the LAN target on the next read.
    const policy = await policyFor(row.userId);
    let result: ParsedWindow;
    if (row.kind === "caldav") {
      const password = decryptApiKey(row.caldavPasswordEncrypted);
      if (!row.caldavUrl || !row.caldavUsername || !password)
        throw new CalendarError("notConfigured");
      // Re-checked on every read: the stored address may predate a demotion.
      normaliseOrFail(row.caldavUrl, policy);
      result = await readCaldav(
        { url: row.caldavUrl, username: row.caldavUsername, password },
        collectionsOf(row.caldavCollections),
        window,
        profileZone,
        policy,
        deps
      );
    } else {
      const url = decryptApiKey(row.icsUrlEncrypted);
      if (!url) throw new CalendarError("notConfigured");
      normaliseOrFail(url, policy);
      result = await readIcs(url, window, profileZone, policy, deps);
    }
    await record(row.id, "ok", null);
    return result;
  } catch (error) {
    const failure = toCalendarError(error);
    await record(row.id, failure.kind, failure.code);
    throw failure;
  }
}

function normaliseOrFail(url: string, policy: TargetPolicy): void {
  try {
    normaliseCalendarUrl(url, policy);
  } catch (error) {
    if (error instanceof AppError && error.code === "PRIVATE_TARGET")
      throw new CalendarError("invalidUrl", "PRIVATE_TARGET");
    if (error instanceof AppError && error.code === "CALENDAR_HTTPS_REQUIRED")
      throw new CalendarError("invalidUrl", "CALENDAR_HTTPS_REQUIRED");
    throw new CalendarError("invalidUrl");
  }
}

async function record(id: string, status: string, code: string | null): Promise<void> {
  await prisma.calendarSource.updateMany({
    where: { id },
    data: { lastStatus: status, lastErrorCode: code, lastCheckedAt: new Date() },
  });
}

export { ownSource };
