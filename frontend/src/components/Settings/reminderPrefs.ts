import type {
  NotificationPreferences,
  NotificationPreferencesPatch,
  ReminderDomain,
  ReminderDomainPrefs,
} from "../../lib/api";

export const REMINDER_DOMAINS: readonly ReminderDomain[] = [
  "flight",
  "cruise",
  "rail",
  "bus",
  "ferry",
  "lodging",
];
export const PRESET_HOURS = [24, 2] as const;
export const MIN_CUSTOM_HOURS = 1;
export const MAX_CUSTOM_HOURS = 168;

export function isPreset(hours: number): boolean {
  return (PRESET_HOURS as readonly number[]).includes(hours);
}

/** The one lead that is neither preset, or null. The server allows at most one. */
export function customLead(leadHours: readonly number[]): number | null {
  return leadHours.find((h) => !isPreset(h)) ?? null;
}

export type CustomLeadCheck =
  { ok: true; hours: number } | { ok: false; reason: "range" | "preset" };

/** Whole hours only: "2.5" or "" are out of range, 24 and 2 are chips of their own. */
export function checkCustomLead(raw: string): CustomLeadCheck {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return { ok: false, reason: "range" };
  const hours = Number(text);
  if (hours < MIN_CUSTOM_HOURS || hours > MAX_CUSTOM_HOURS) return { ok: false, reason: "range" };
  if (isPreset(hours)) return { ok: false, reason: "preset" };
  return { ok: true, hours };
}

/** Folds a newer patch over an older one, domain by domain and field by field. */
export function mergePatch(
  older: NotificationPreferencesPatch | null,
  newer: NotificationPreferencesPatch
): NotificationPreferencesPatch {
  if (!older) return newer;
  const domains: Partial<Record<ReminderDomain, Partial<ReminderDomainPrefs>>> = {
    ...older.domains,
  };
  for (const key of Object.keys(newer.domains ?? {}) as ReminderDomain[]) {
    domains[key] = { ...domains[key], ...newer.domains?.[key] };
  }
  const merged: NotificationPreferencesPatch = { ...older, ...newer };
  if (older.domains || newer.domains) merged.domains = domains;
  return merged;
}

export function applyPatch(
  prefs: NotificationPreferences,
  patch: NotificationPreferencesPatch
): NotificationPreferences {
  const domains = { ...prefs.domains };
  for (const key of Object.keys(patch.domains ?? {}) as ReminderDomain[]) {
    domains[key] = { ...domains[key], ...patch.domains?.[key] };
  }
  return {
    ...prefs,
    ...(patch.notificationEmail !== undefined && { notificationEmail: patch.notificationEmail }),
    domains,
  };
}
