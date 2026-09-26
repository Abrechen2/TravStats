import { prisma } from "../../db";
import type { Prisma } from "../../prisma";
import { z } from "../../schemas/zod";
import { profileZoneFromSettings } from "../../shared/time/profileZone";
import { isValidZone } from "../../shared/time/zonedParts";

/**
 * The profile zone as a setting of its own (ADR 0002 Q1, owner decision
 * 2026-09-26 "ask at the next login").
 *
 * It lives in `UserSettings.data.display.timezone`, where the web has always
 * kept it, and `PUT /settings` still writes it there. This is the narrow
 * write for the two clients that only want the zone — the login prompt and
 * the Companion's "follow this device" — because `PUT /settings` replaces
 * the whole `display` block, and a phone that sent only its zone would wipe
 * the user's theme and date format.
 */

export const profileZoneBodySchema = z
  .object({
    zone: z.string().refine((zone) => isValidZone(zone), "ZONE_UNKNOWN"),
    followsDevice: z.boolean().optional(),
  })
  .strict()
  .openapi("ProfileZoneInput");

export type ProfileZoneBody = z.infer<typeof profileZoneBodySchema>;

export interface ProfileZoneView {
  zone: string;
  source: "profile" | "default-utc";
  hasProfileZone: boolean;
  followsDevice: boolean;
}

export const profileZoneViewSchema = z
  .object({
    zone: z.string().describe("IANA zone that answers 'today' for this account"),
    source: z
      .enum(["profile", "default-utc"])
      .describe("`default-utc`: the account has no usable zone and 'today' is UTC"),
    hasProfileZone: z
      .boolean()
      .describe("False until the user confirms a zone — the web asks at the next login"),
    followsDevice: z.boolean().describe("The Companion keeps the zone in step with the device"),
  })
  .openapi("ProfileZone");

/** The view of a stored `UserSettings.data` value. */
export function profileZoneView(data: unknown): ProfileZoneView {
  const resolved = profileZoneFromSettings(data);
  const display = (data as { display?: { timezoneFollowsDevice?: unknown } } | null)?.display;
  return {
    zone: resolved.zone,
    source: resolved.source,
    hasProfileZone: resolved.source === "profile",
    followsDevice: display?.timezoneFollowsDevice === true,
  };
}

/** Writes the zone into `display` without touching the rest of the block. */
export async function saveProfileZone(
  userId: string,
  body: ProfileZoneBody
): Promise<ProfileZoneView> {
  const existing = await prisma.userSettings.findUnique({
    where: { userId },
    select: { data: true },
  });
  const data =
    existing && typeof existing.data === "object" && existing.data !== null
      ? (existing.data as Record<string, unknown>)
      : {};
  const display =
    typeof data.display === "object" && data.display !== null
      ? (data.display as Record<string, unknown>)
      : {};
  const next = {
    ...data,
    display: {
      ...display,
      timezone: body.zone,
      ...(body.followsDevice !== undefined ? { timezoneFollowsDevice: body.followsDevice } : {}),
    },
  };
  const json = next as unknown as Prisma.InputJsonValue;
  await prisma.userSettings.upsert({
    where: { userId },
    create: { userId, data: json },
    update: { data: json },
  });
  return profileZoneView(next);
}
