import type { ReminderDomain } from "../../lib/api";

/** In the order the design lists the areas. */
export const REMINDER_DOMAINS: readonly ReminderDomain[] = [
  "flight",
  "cruise",
  "lodging",
  "rail",
  "bus",
  "ferry",
  "rental",
  "roadtrip",
  "poi",
];
export const LEAD_OFF = "off";
export const LEAD_CUSTOM = "custom";
/** The select's lead times, in hours: "2 h", "24 h" and "2 Tage". */
const LEAD_CHOICES: readonly number[] = [2, 24, 48];

/**
 * What the select shows for a stored row: off, one of its three leads, or
 * "custom" for any other stored set (two leads, 36 h, ...). A row that is on
 * but has no lead sends nothing, so it reads as off.
 */
export function leadChoiceOf(row: { enabled: boolean; leadHours: readonly number[] }): string {
  if (!row.enabled || row.leadHours.length === 0) return LEAD_OFF;
  const only = row.leadHours.length === 1 ? row.leadHours[0] : undefined;
  return only !== undefined && LEAD_CHOICES.includes(only) ? String(only) : LEAD_CUSTOM;
}

/** "36 h" or "24 h + 2 h": a lead set the select has no entry for. */
export function ownLeadLabel(leadHours: readonly number[]): string {
  return leadHours.map((h) => `${h} h`).join(" + ");
}

/**
 * The change a pick makes. Off keeps the stored leads (switching an area off
 * and on again must not lose its own time); the custom entry is a display of
 * what is stored, picking it again changes nothing.
 */
export function leadPatch(choice: string): { enabled: boolean; leadHours?: number[] } | null {
  if (choice === LEAD_OFF) return { enabled: false };
  if (choice === LEAD_CUSTOM) return null;
  const hours = Number(choice);
  return LEAD_CHOICES.includes(hours) ? { enabled: true, leadHours: [hours] } : null;
}
