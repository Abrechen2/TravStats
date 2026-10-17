import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { DomainKey } from "../../shared/domains";
import { now } from "../../shared/time/clock";
import { loadVisibleDomains } from "../domainVisibility";
import { getInstanceSettings } from "../instanceSettingsService";
import type { FeedContext } from "./feedEvent";
import { writeCalendar, type IcsEvent } from "./ics";
import { busEvents, ferryEvents, flightEvents, railEvents, rentalEvents } from "./journeyEvents";
import { roadtripStationEvents, tourEvents } from "./roadtripEvents";
import { cruiseEvents, stayEvents, tripEvents } from "./stayCruiseTripEvents";
import { calendarTokenHash, generateCalendarToken, looksLikeCalendarToken } from "./token";

/**
 * The calendar feed (forgejo#310): a secret URL per user that any calendar app
 * subscribes to, answering the upcoming entries plus a look-back.
 *
 * The feed is a beta feature (`calendarFeed` in
 * `frontend/src/config/betaFeatures.ts`), and the gate holds on the server too:
 * with the instance's beta switch off no URL is issued and every URL answers
 * 404, the way the comparison and the encrypted share refuse — a subscription
 * keeps polling long after anybody looks at the settings page that hid it.
 */

/** Entries that ended up to this many days ago stay in the feed. */
export const CALENDAR_FEED_LOOKBACK_DAYS = 30;
/** How often a calendar app is asked to poll. */
export const CALENDAR_FEED_REFRESH_MINUTES = 60;
export const CALENDAR_FEED_NAME = "TravStats";

type Reader = (ctx: FeedContext) => Promise<IcsEvent[]>;

/**
 * Which readers each domain contributes. A `Record` over every key, so a domain
 * added to `shared/domains.ts` is a type error here until it is classified.
 */
const DOMAIN_READERS: Record<DomainKey, Reader[]> = {
  flight: [flightEvents],
  cruise: [cruiseEvents],
  lodging: [stayEvents],
  // A place visit is a record of having been somewhere, kept by day or less;
  // nothing in it is scheduled, so it has no place in a calendar of plans.
  poi: [],
  // Tours share the roadtrip switch and beta key, as they do in the UI.
  roadtrip: [roadtripStationEvents, tourEvents],
  rail: [railEvents],
  rental: [rentalEvents],
  bus: [busEvents],
  ferry: [ferryEvents],
};

export const feedDisabled = () =>
  new AppError(
    "The calendar feed is not available on this instance",
    409,
    "CALENDAR_FEED_DISABLED"
  );

export async function calendarFeedEnabled(): Promise<boolean> {
  return (await getInstanceSettings()).betaFeaturesEnabled;
}

export interface CalendarFeedStatus {
  enabled: boolean;
  active: boolean;
  createdAt: string | null;
  lastUsedAt: string | null;
}

export async function feedStatus(userId: string): Promise<CalendarFeedStatus> {
  const [enabled, feed] = await Promise.all([
    calendarFeedEnabled(),
    prisma.calendarFeed.findUnique({
      where: { userId },
      select: { createdAt: true, lastUsedAt: true },
    }),
  ]);
  return {
    enabled,
    active: feed !== null,
    createdAt: feed?.createdAt.toISOString() ?? null,
    lastUsedAt: feed?.lastUsedAt?.toISOString() ?? null,
  };
}

export interface IssuedCalendarFeed {
  url: string;
  webcalUrl: string;
  createdAt: string;
}

/** The subscription address of a token, as `https:` and as `webcal:`. */
export function feedUrls(baseUrl: string, token: string): { url: string; webcalUrl: string } {
  const url = `${baseUrl}/api/v1/calendar/${token}.ics`;
  return { url, webcalUrl: url.replace(/^https?:\/\//i, "webcal://") };
}

/**
 * A new URL for the user — the first one, or a replacement. The previous token
 * stops working in the same write: one row per user, its hash replaced.
 */
export async function issueFeed(userId: string, baseUrl: string): Promise<IssuedCalendarFeed> {
  if (!(await calendarFeedEnabled())) throw feedDisabled();
  const { token, tokenHash } = generateCalendarToken();
  const createdAt = now();
  await prisma.calendarFeed.upsert({
    where: { userId },
    create: { userId, tokenHash, createdAt },
    update: { tokenHash, createdAt, lastUsedAt: null },
  });
  return { ...feedUrls(baseUrl, token), createdAt: createdAt.toISOString() };
}

/** Revoking always works, beta switch or not. True when there was a URL to revoke. */
export async function revokeFeed(userId: string): Promise<boolean> {
  const { count } = await prisma.calendarFeed.deleteMany({ where: { userId } });
  return count > 0;
}

/**
 * The owner of a live token, or null for anything else — malformed, unknown,
 * revoked, or the instance's beta switch off. One answer, so the public
 * endpoint is no oracle. A hit records when the feed was last read.
 */
export async function resolveFeedOwner(token: string): Promise<string | null> {
  if (!looksLikeCalendarToken(token)) return null;
  if (!(await calendarFeedEnabled())) return null;
  const feed = await prisma.calendarFeed.findUnique({
    where: { tokenHash: calendarTokenHash(token) },
    select: { id: true, userId: true },
  });
  if (!feed) return null;
  await prisma.calendarFeed.update({ where: { id: feed.id }, data: { lastUsedAt: now() } });
  return feed.userId;
}

const startOf = (event: IcsEvent): string =>
  event.bounds.kind === "timed" ? event.bounds.start.toISOString() : event.bounds.start;

/**
 * The user's calendar: every visible domain's entries that have not ended
 * more than the look-back ago, plus the trips around them. A domain the user
 * switched off, or one behind the beta switch while it is off, contributes
 * nothing (`loadVisibleDomains`, the gate `/upcoming` uses).
 */
export async function buildFeed(userId: string, baseUrl: string): Promise<string> {
  const generatedAt = now();
  const ctx: FeedContext = {
    userId,
    baseUrl,
    cutoff: new Date(generatedAt.getTime() - CALENDAR_FEED_LOOKBACK_DAYS * 86_400_000),
  };
  const visible = await loadVisibleDomains(userId);
  const readers = [tripEvents, ...visible.flatMap((domain) => DOMAIN_READERS[domain])];
  const events = (await Promise.all(readers.map((read) => read(ctx))))
    .flat()
    .sort((a, b) => startOf(a).localeCompare(startOf(b)) || a.uid.localeCompare(b.uid));
  return writeCalendar({
    name: CALENDAR_FEED_NAME,
    refreshMinutes: CALENDAR_FEED_REFRESH_MINUTES,
    generatedAt,
    events,
  });
}
