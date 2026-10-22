import { z } from "zod";
import { prisma } from "../../db";
import { TRIP_COLORS } from "../../schemas/trip";

/**
 * Account preferences from the settings prototype (forgejo#321, owner
 * 2026-10-22): the colour of a new trip, whether sea days count as cruise
 * days, and whether the server takes the Companion's flight positions.
 *
 * Flat columns on `UserSettings`, nested by the API the way
 * `suggestionSwitches.ts` nests its own — a JSON-blob slice would be replaced
 * whole by a PUT that names the slice, so a client writing one of these would
 * wipe the cruise or feature preferences beside it.
 *
 * Every default is the behaviour from before the setting existed, so an
 * account that never opens the page sees nothing change.
 */

type TripColor = (typeof TRIP_COLORS)[number];

/** A colour from the trip palette, or null for "rotate as before". */
export const tripDefaultsSettingsSchema = z
  .object({
    color: z.enum(TRIP_COLORS as unknown as [TripColor, ...TripColor[]]).nullable(),
  })
  .partial()
  .strict();

export const cruiseSeaDaysSettingsSchema = z.object({ counted: z.boolean() }).partial().strict();

export const liveTrackingSettingsSchema = z.object({ enabled: z.boolean() }).partial().strict();

export const ACCOUNT_PREFS_SELECT = {
  tripDefaultColor: true,
  cruiseCountSeaDays: true,
  flightLiveTrackingEnabled: true,
} as const;

export interface AccountPrefsColumns {
  tripDefaultColor: string | null;
  cruiseCountSeaDays: boolean;
  flightLiveTrackingEnabled: boolean;
}

/** The column defaults — what an account without a settings row is answered with. */
export const ACCOUNT_PREFS_DEFAULTS: AccountPrefsColumns = {
  tripDefaultColor: null,
  cruiseCountSeaDays: true,
  flightLiveTrackingEnabled: true,
};

export interface AccountPrefsView {
  /** `color` null = new trips rotate through the palette. */
  tripDefaults: { color: string | null };
  /** Whether sea days count in the cruise day total. */
  cruiseSeaDays: { counted: boolean };
  /** Whether the server takes the Companion's flight recording. */
  liveTracking: { enabled: boolean };
}

/**
 * A stored colour the palette no longer holds reads as "automatic", not as a
 * colour nobody can pick again in the select that shows it.
 */
function paletteColor(value: string | null): string | null {
  return value !== null && (TRIP_COLORS as readonly string[]).includes(value) ? value : null;
}

export function accountPrefsView(record: AccountPrefsColumns): AccountPrefsView {
  return {
    tripDefaults: { color: paletteColor(record.tripDefaultColor) },
    cruiseSeaDays: { counted: record.cruiseCountSeaDays },
    liveTracking: { enabled: record.flightLiveTrackingEnabled },
  };
}

/** Only the keys a PUT named; an absent key leaves its column alone. */
export function accountPrefsUpdate(
  trip: z.infer<typeof tripDefaultsSettingsSchema> | undefined,
  seaDays: z.infer<typeof cruiseSeaDaysSettingsSchema> | undefined,
  live: z.infer<typeof liveTrackingSettingsSchema> | undefined
): Partial<AccountPrefsColumns> {
  return {
    ...(trip?.color !== undefined ? { tripDefaultColor: trip.color } : {}),
    ...(seaDays?.counted !== undefined ? { cruiseCountSeaDays: seaDays.counted } : {}),
    ...(live?.enabled !== undefined ? { flightLiveTrackingEnabled: live.enabled } : {}),
  };
}

export async function readAccountPrefs(userId: string): Promise<AccountPrefsColumns> {
  const row = await prisma.userSettings.findUnique({
    where: { userId },
    select: ACCOUNT_PREFS_SELECT,
  });
  return row ?? ACCOUNT_PREFS_DEFAULTS;
}

export async function flightLiveTrackingEnabled(userId: string): Promise<boolean> {
  return (await readAccountPrefs(userId)).flightLiveTrackingEnabled;
}

export async function cruiseSeaDaysCounted(userId: string): Promise<boolean> {
  return (await readAccountPrefs(userId)).cruiseCountSeaDays;
}
