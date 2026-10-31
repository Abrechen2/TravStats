import { z } from "zod";
import { prisma } from "../../db";
import {
  MAX_LEAD_HOURS,
  PRESET_LEAD_HOURS,
  REMINDER_DOMAINS,
  REMINDER_USER_SELECT,
  resolvePref,
  type DomainReminderPref,
  type PrefUser,
  type ReminderDomain,
} from "./prefs";

/** The `domains` part of GET/PUT /settings/notifications (package 11). */
export const leadHoursSchema = z
  .array(z.number().int().min(1).max(MAX_LEAD_HOURS))
  .max(3)
  .refine((v) => new Set(v).size === v.length, "leadHours must be unique")
  .refine(
    (v) => v.filter((h) => !(PRESET_LEAD_HOURS as readonly number[]).includes(h)).length <= 1,
    "leadHours allows the presets 24 and 2 plus at most one custom value"
  );

export const domainPrefInput = z
  .object({
    enabled: z.boolean().optional(),
    leadHours: leadHoursSchema.optional(),
    channel: z.enum(["app", "mail", "both"]).optional(),
  })
  .strict();

export const domainsInput = z
  .object(
    Object.fromEntries(REMINDER_DOMAINS.map((d) => [d, domainPrefInput.optional()])) as Record<
      ReminderDomain,
      z.ZodOptional<typeof domainPrefInput>
    >
  )
  .strict();

export type DomainsInput = z.infer<typeof domainsInput>;

const sortedLeads = (v: number[]) => [...v].sort((a, b) => b - a);

export function domainsView(user: PrefUser): Record<ReminderDomain, DomainReminderPref> {
  return Object.fromEntries(
    REMINDER_DOMAINS.map((d) => {
      const pref = resolvePref(user, d);
      return [d, { ...pref, leadHours: sortedLeads(pref.leadHours) }];
    })
  ) as Record<ReminderDomain, DomainReminderPref>;
}

export interface LegacyWrite {
  notificationEmail?: string | null;
  notifyBefore24h?: boolean;
  notifyBefore2h?: boolean;
}

/**
 * Applies a PUT. An old client sends the two legacy switches: they are stored
 * and fanned out to every domain row (the preset added or removed, a custom
 * lead untouched). A new client sends `domains`: every domain gets a row, and
 * the legacy columns are re-derived (a preset lead in use by an enabled
 * domain) so an old client reading them sees the truth.
 */
export async function applySettings(
  userId: string,
  legacy: LegacyWrite,
  domains: DomainsInput | undefined
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // One writer per user at a time: a PUT reads the current rows and derives the legacy
    // switches from them, so two concurrent PUTs (phone + browser) must not read the same
    // snapshot. Released at commit.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('reminder_prefs'), hashtext(${userId}))`;
    const data: LegacyWrite = {};
    if (legacy.notificationEmail !== undefined) data.notificationEmail = legacy.notificationEmail;
    if (legacy.notifyBefore24h !== undefined) data.notifyBefore24h = legacy.notifyBefore24h;
    if (legacy.notifyBefore2h !== undefined) data.notifyBefore2h = legacy.notifyBefore2h;
    if (Object.keys(data).length > 0) await tx.user.update({ where: { id: userId }, data });

    const fan: Array<[number, boolean | undefined]> = [
      [24, legacy.notifyBefore24h],
      [2, legacy.notifyBefore2h],
    ];
    if (fan.some(([, on]) => on !== undefined)) {
      const rows = await tx.reminderPreference.findMany({ where: { userId } });
      for (const row of rows) {
        let leads = row.leadHours;
        for (const [hour, on] of fan) {
          if (on === undefined) continue;
          leads = on ? [...new Set([...leads, hour])] : leads.filter((h) => h !== hour);
        }
        // Switching a lead ON through the old API means "mail me": the row is enabled and an
        // app-only channel gains the mail.
        const turnedOn = fan.some(([, on]) => on === true);
        await tx.reminderPreference.update({
          where: { id: row.id },
          data: {
            leadHours: leads,
            ...(turnedOn && {
              enabled: true,
              channel: row.channel === "app" ? "both" : row.channel,
            }),
          },
        });
      }
    }

    if (!domains) return;
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: REMINDER_USER_SELECT.select,
    });
    const view = domainsView(user);
    // Only the supplied domains are rewritten; a domain without a row gets one from its
    // resolved defaults (create-only, so a row written meanwhere is never overwritten).
    const existing = new Set(
      (await tx.reminderPreference.findMany({ where: { userId }, select: { domain: true } })).map(
        (r) => r.domain
      )
    );
    for (const domain of REMINDER_DOMAINS) {
      const supplied = domains[domain];
      if (!supplied && existing.has(domain)) continue;
      const merged = { ...view[domain], ...(supplied ?? {}) };
      const fields = {
        enabled: merged.enabled,
        leadHours: sortedLeads(merged.leadHours),
        channel: merged.channel,
      };
      if (supplied) {
        await tx.reminderPreference.upsert({
          where: { userId_domain: { userId, domain } },
          create: { userId, domain, ...fields },
          update: fields,
        });
      } else {
        await tx.reminderPreference.createMany({
          data: [{ userId, domain, ...fields }],
          skipDuplicates: true,
        });
      }
      view[domain] = { ...merged, leadHours: fields.leadHours };
    }
    const used = (hour: number) =>
      REMINDER_DOMAINS.some((d) => view[d].enabled && view[d].leadHours.includes(hour));
    await tx.user.update({
      where: { id: userId },
      data: { notifyBefore24h: used(24), notifyBefore2h: used(2) },
    });
  });
}
