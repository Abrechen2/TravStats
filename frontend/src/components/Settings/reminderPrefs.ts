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
/** The server's own default for a new account: 24 h and 2 h before departure. */
export const LEAD_STANDARD = "standard";
const STANDARD_LEADS: readonly number[] = [24, 2];
/** The select's lead times, in hours: "2 h", "24 h" and "2 Tage". */
const LEAD_CHOICES: readonly number[] = [2, 24, 48];

/**
 * Is this exactly the server's default pair (24 h and 2 h, in either order)?
 * Every new account holds it, so showing it as "Eigene: 24 h + 2 h" would tell
 * each of them they had set something.
 */
export function isStandardLead(row: { leadHours: readonly number[] }): boolean {
  return (
    row.leadHours.length === STANDARD_LEADS.length &&
    STANDARD_LEADS.every((h) => row.leadHours.includes(h))
  );
}

/**
 * What the select shows for a stored row: off, one of its three leads, the
 * server's default pair, or "custom" for any other stored set (two other leads,
 * 36 h, ...). A row that is on but has no lead sends nothing, so it reads as off.
 */
export function leadChoiceOf(row: { enabled: boolean; leadHours: readonly number[] }): string {
  if (!row.enabled || row.leadHours.length === 0) return LEAD_OFF;
  if (isStandardLead(row)) return LEAD_STANDARD;
  const only = row.leadHours.length === 1 ? row.leadHours[0] : undefined;
  return only !== undefined && LEAD_CHOICES.includes(only) ? String(only) : LEAD_CUSTOM;
}

/** "36 h" or "24 h + 2 h": a lead set the select has no entry for. */
export function ownLeadLabel(leadHours: readonly number[]): string {
  return leadHours.map((h) => `${h} h`).join(" + ");
}

/** Does the row keep leads the select has no entry for (two leads, 36 h, ...)? */
export function hasOwnLead(row: { leadHours: readonly number[] }): boolean {
  if (row.leadHours.length === 0 || isStandardLead(row)) return false;
  const only = row.leadHours.length === 1 ? row.leadHours[0] : undefined;
  return only === undefined || !LEAD_CHOICES.includes(only);
}

/**
 * The change a pick makes. Off keeps the stored leads (switching an area off
 * and on again must not lose its own time); picking the custom entry switches
 * the area on with the leads it already has.
 */
export function leadPatch(choice: string): { enabled: boolean; leadHours?: number[] } | null {
  if (choice === LEAD_OFF) return { enabled: false };
  if (choice === LEAD_CUSTOM) return { enabled: true };
  if (choice === LEAD_STANDARD) return { enabled: true, leadHours: [...STANDARD_LEADS] };
  const hours = Number(choice);
  return LEAD_CHOICES.includes(hours) ? { enabled: true, leadHours: [hours] } : null;
}
