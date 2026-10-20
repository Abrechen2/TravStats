import { z } from "zod";

/**
 * How much of the settings page an account sees (forgejo#321). `standard`
 * shows the everyday controls, `expert` everything. It hides controls, never
 * values: a setting chosen in expert mode keeps applying in standard mode.
 */
export const SETTINGS_LEVELS = ["standard", "expert"] as const;
export type SettingsLevel = (typeof SETTINGS_LEVELS)[number];

export const settingsLevelSchema = z.enum(SETTINGS_LEVELS);

/**
 * The column is plain TEXT, so a value written outside this API (a hand edit,
 * a future third level read by an older server) is answered as `standard`,
 * the level every new account starts at, rather than leaking an unknown word
 * to a client that switches on it.
 */
export function parseSettingsLevel(stored: string | null | undefined): SettingsLevel {
  return (SETTINGS_LEVELS as readonly string[]).includes(stored ?? "")
    ? (stored as SettingsLevel)
    : "standard";
}
