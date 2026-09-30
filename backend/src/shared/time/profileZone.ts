import { prisma } from "../../db";
import logger from "../../utils/logger";
import { isValidZone } from "./zonedParts";

/**
 * The user's profile zone — the zone that answers "today", "past or
 * planned" and countdowns (ADR 0002 D4, owner decision Q1). NEVER a place's
 * zone: where something happened is `resolveZone`'s question, and a profile
 * zone standing in for it would put a Tokyo departure on Berlin's clock.
 *
 * Stored today in `UserSettings.data.display.timezone`, written by the web.
 * A user who never set one (seeds leave it out, #87) or whose value is not a
 * zone this runtime knows gets UTC, labelled `default-utc` so the caller can
 * show the hint the owner asked for until the user confirms a zone at the
 * next login (a later phase builds that prompt).
 */

export type ProfileZoneSource = "profile" | "default-utc";

export interface ProfileZone {
  zone: string;
  source: ProfileZoneSource;
}

const DEFAULT_UTC: ProfileZone = { zone: "UTC", source: "default-utc" };

/** Reads the profile zone out of a `UserSettings.data` value; pure, for callers that already hold the row. */
export function profileZoneFromSettings(data: unknown): ProfileZone {
  const display = (data as { display?: { timezone?: unknown } } | null | undefined)?.display;
  const zone = display?.timezone;
  return isValidZone(zone) ? { zone, source: "profile" } : DEFAULT_UTC;
}

/**
 * The profile zone of a user. The UTC default is logged, so a server that
 * answers "today" in UTC for most of its users says so instead of doing it
 * in silence.
 */
export async function profileZoneOf(userId: string): Promise<ProfileZone> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { data: true },
  });
  const result = profileZoneFromSettings(settings?.data);
  if (result.source === "default-utc") {
    const stored = (settings?.data as { display?: { timezone?: unknown } } | null)?.display
      ?.timezone;
    logger.info({
      operation: "profile_zone_default_utc",
      message: "User has no usable profile zone; 'today' is answered in UTC",
      context: { userId, reason: stored === undefined ? "unset" : "not-a-zone" },
    });
  }
  return result;
}
