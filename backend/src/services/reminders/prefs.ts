import { prisma } from "../../db";
import logger from "../../utils/logger";

/**
 * Per-domain reminder settings (package 11) and the one rule that reads them.
 *
 * A user with a `reminder_preferences` row for a domain is read from it. A
 * user without one (created after the migration, never opened the settings)
 * is read from the legacy columns through {@link legacyPref}, which is the
 * migration's backfill written in TypeScript, so "no row" and "backfilled row"
 * answer the same.
 */
export const REMINDER_DOMAINS = ["flight", "cruise", "rail", "bus", "ferry", "lodging"] as const;
export type ReminderDomain = (typeof REMINDER_DOMAINS)[number];
export type ReminderChannel = "app" | "mail" | "both";

export const PRESET_LEAD_HOURS = [24, 2] as const;
export const MAX_LEAD_HOURS = 168;

export interface DomainReminderPref {
  enabled: boolean;
  leadHours: number[];
  channel: ReminderChannel;
}

/** What every reminder query selects about the account. */
export const REMINDER_USER_SELECT = {
  select: {
    id: true,
    notificationEmail: true,
    notifyBefore24h: true,
    notifyBefore2h: true,
    settings: { select: { data: true, enabledDomains: true } },
    reminderPreferences: {
      select: { domain: true, enabled: true, leadHours: true, channel: true },
    },
    devicePushes: { select: { reminders: true } },
  },
} as const;

export interface PrefUser {
  id?: string;
  notificationEmail: string | null;
  notifyBefore24h: boolean;
  notifyBefore2h: boolean;
  settings?: { data: unknown; enabledDomains: string[] } | null;
  reminderPreferences?: Array<{
    domain: string;
    enabled: boolean;
    leadHours: number[];
    channel: string;
  }>;
  devicePushes?: Array<{ reminders: boolean }>;
}

const asChannel = (value: string): ReminderChannel =>
  value === "app" || value === "mail" ? value : "both";

/** The migration's backfill, for an account that has no row for this domain. */
export function legacyPref(user: PrefUser, domain: ReminderDomain): DomainReminderPref {
  const lodging = domain === "lodging";
  const h24 = user.notifyBefore24h;
  const h2 = user.notifyBefore2h && !lodging;
  const mailOn = user.notificationEmail !== null && (h24 || h2);
  const appOn = (user.devicePushes ?? []).some((d) => d.reminders);
  const leadHours = mailOn ? [...(h24 ? [24] : []), ...(h2 ? [2] : [])] : [...PRESET_LEAD_HOURS];
  return {
    enabled: mailOn || appOn,
    leadHours,
    channel: mailOn && appOn ? "both" : appOn ? "app" : "mail",
  };
}

export function resolvePref(user: PrefUser, domain: ReminderDomain): DomainReminderPref {
  const row = user.reminderPreferences?.find((p) => p.domain === domain);
  if (!row) return legacyPref(user, domain);
  return { enabled: row.enabled, leadHours: [...row.leadHours], channel: asChannel(row.channel) };
}

/** Whether the account turned this domain on at all (`UserSettings.enabledDomains`). */
export function domainSwitchedOn(user: PrefUser, domain: ReminderDomain): boolean {
  return (user.settings?.enabledDomains ?? ["flight"]).includes(domain);
}

/** The lead hours at which this account wants this domain announced; [] when it wants nothing. */
export function leadsFor(user: PrefUser, domain: ReminderDomain): number[] {
  const pref = resolvePref(user, domain);
  return pref.enabled && domainSwitchedOn(user, domain) ? pref.leadHours : [];
}

export const wantsMail = (user: PrefUser, domain: ReminderDomain, hours: number): boolean => {
  const pref = resolvePref(user, domain);
  return (
    leadsFor(user, domain).includes(hours) &&
    pref.channel !== "app" &&
    user.notificationEmail !== null
  );
};

export const wantsApp = (user: PrefUser, domain: ReminderDomain, hours: number): boolean =>
  leadsFor(user, domain).includes(hours) && resolvePref(user, domain).channel !== "mail";

/**
 * Every lead the scheduler must look at: the presets plus each custom value
 * some account uses. A failed read still serves the presets — a custom lead
 * missing for one run beats no reminder at all.
 */
export async function activeLeadHours(): Promise<number[]> {
  const leads = new Set<number>(PRESET_LEAD_HOURS);
  try {
    const rows = await prisma.reminderPreference.findMany({
      where: { enabled: true },
      select: { leadHours: true },
    });
    for (const row of rows) for (const h of row.leadHours) leads.add(h);
  } catch (error) {
    logger.warn({
      operation: "reminder_leads_read_failed",
      error: { message: error instanceof Error ? error.message : "Unknown error" },
    });
  }
  return [...leads].sort((a, b) => b - a);
}
