/**
 * What a readiness evaluation reads — loaded once per request from STORED state
 * (spec 2026-11-14 §3.1, §8): rows the app already keeps, plus one local
 * `statfs`. Nothing here opens a network connection or sends a mail; a check
 * that needs a probe reads the result of the last test instead.
 */
import { statfs } from "fs/promises";
import { prisma } from "../../db";
import { BACKUP_BASE_DIR } from "../backup/backupConfig";
import { loadAllTests } from "../externalServices/tests";
import type { LastTest } from "../externalServices/types";

export interface InstanceFacts {
  smtp: { enabled: boolean } | null;
  smtpTest: LastTest | null;
  publicUrl: string | null;
  publicUrlCheck: { at: Date; ok: boolean; url: string | null } | null;
  backupInterval: "daily" | "weekly" | "monthly";
  /** The latest scheduled backup that finished one way or the other. */
  latestScheduledBackup: { status: string; at: Date } | null;
  offsiteConfigured: boolean;
  /** Stored tests of the instance's keyed providers. */
  providerTests: ReadonlyMap<string, LastTest>;
  instanceMailbox: { lastOkAt: Date | null; lastErrorAt: Date | null } | null;
  travtrackOffered: boolean;
  /** Free fraction of the backup volume, or null when it cannot be read. */
  disk: { freeBytes: number; freeFraction: number } | null;
}

export interface AccountFacts {
  enabledDomains: string[];
  hasFlights: boolean;
  locationProvider: string;
  hasHome: boolean;
  hasPairedDevice: boolean;
  hasRecordedPosition: boolean;
  /** Stored tests of the account's own keys and connections. */
  tests: ReadonlyMap<string, LastTest>;
  hasImmichOrDawarich: boolean;
  hasForwardingAddress: boolean;
  allowedSenders: number;
  mailReminders: boolean;
  notificationEmail: string | null;
}

export interface ReadinessContext {
  now: Date;
  userId: string;
  isAdmin: boolean;
  instance: InstanceFacts;
  account: AccountFacts;
}

/** The services whose instance-level key a provider check judges. */
export const PROVIDER_SERVICE_IDS: readonly string[] = [
  "aeroapi",
  "opensky",
  "aisstream",
  "railTimetables",
  "googlePlaces",
];

const DISK_CACHE_MS = 60_000;
let diskCache: { at: number; value: InstanceFacts["disk"] } | null = null;

async function readDisk(now: Date): Promise<InstanceFacts["disk"]> {
  if (diskCache && now.getTime() - diskCache.at < DISK_CACHE_MS) return diskCache.value;
  let value: InstanceFacts["disk"] = null;
  // The backup volume if it exists yet, else the working directory's.
  for (const dir of [BACKUP_BASE_DIR, process.cwd()]) {
    try {
      const s = await statfs(dir);
      const total = Number(s.blocks) * Number(s.bsize);
      const freeBytes = Number(s.bavail) * Number(s.bsize);
      if (total > 0) {
        value = { freeBytes, freeFraction: freeBytes / total };
        break;
      }
    } catch {
      // try the next directory; none readable leaves the check `unknown`
    }
  }
  diskCache = { at: now.getTime(), value };
  return value;
}

/** Test seam: forget the cached disk reading. */
export function resetDiskCache(): void {
  diskCache = null;
}

function toInterval(v: string | undefined): InstanceFacts["backupInterval"] {
  return v === "daily" || v === "monthly" ? v : "weekly";
}

async function loadInstance(now: Date): Promise<InstanceFacts> {
  const [admin, smtp, tests, backup, mailbox, travtrack, disk] = await Promise.all([
    prisma.adminSettings.findFirst({ orderBy: { id: "asc" } }),
    prisma.smtpConfig.findUnique({ where: { id: 1 } }),
    loadAllTests(null),
    prisma.backup.findFirst({
      where: { scheduled: true, status: { in: ["completed", "failed"] } },
      orderBy: { createdAt: "desc" },
      select: { status: true, completedAt: true, createdAt: true },
    }),
    prisma.mailIntakeSource.findFirst({
      where: { userId: null, enabled: true },
      select: { lastOkAt: true, lastErrorAt: true },
    }),
    prisma.travTrackConfig.findUnique({ where: { id: "default" } }),
    readDisk(now),
  ]);
  const providerTests = new Map<string, LastTest>();
  for (const id of PROVIDER_SERVICE_IDS) {
    const t = tests.get(id);
    if (t) providerTests.set(id, t);
  }
  return {
    smtp: smtp ? { enabled: smtp.enabled } : null,
    smtpTest: tests.get("smtp") ?? null,
    publicUrl: admin?.publicUrl ?? null,
    publicUrlCheck:
      admin?.publicUrlCheckedAt && admin.publicUrlCheckOk !== null
        ? {
            at: admin.publicUrlCheckedAt,
            ok: admin.publicUrlCheckOk,
            url: admin.publicUrlCheckedUrl,
          }
        : null,
    backupInterval: toInterval(admin?.backupInterval),
    latestScheduledBackup: backup
      ? { status: backup.status, at: backup.completedAt ?? backup.createdAt }
      : null,
    offsiteConfigured: Boolean(admin?.webdavSyncEnabled && admin.webdavUrl),
    providerTests,
    instanceMailbox: mailbox,
    travtrackOffered: travtrack?.enabled ?? false,
    disk,
  };
}

async function loadAccount(userId: string): Promise<AccountFacts> {
  const [settings, user, flight, pairing, point, tests, mailAddress, senders, reminders] =
    await Promise.all([
      prisma.userSettings.findUnique({
        where: { userId },
        select: {
          enabledDomains: true,
          locationProvider: true,
          homePlace: true,
          immichBaseUrl: true,
          dawarichBaseUrl: true,
        },
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { notificationEmail: true } }),
      prisma.flight.findFirst({ where: { userId }, select: { id: true } }),
      prisma.apiToken.findFirst({
        where: { userId, revokedAt: null, deviceId: { not: null } },
        select: { id: true },
      }),
      prisma.travTrackPoint.findFirst({ where: { userId }, select: { id: true } }),
      loadAllTests(userId),
      prisma.mailIntakeAddress.findUnique({ where: { userId }, select: { userId: true } }),
      prisma.mailIntakeSender.count({ where: { userId } }),
      prisma.reminderPreference.findFirst({
        where: { userId, enabled: true, channel: { in: ["mail", "both"] } },
        select: { id: true },
      }),
    ]);
  return {
    enabledDomains: settings?.enabledDomains ?? ["flight"],
    hasFlights: flight !== null,
    locationProvider: settings?.locationProvider ?? "none",
    hasHome: settings?.homePlace != null,
    hasPairedDevice: pairing !== null,
    hasRecordedPosition: point !== null,
    tests,
    hasImmichOrDawarich: Boolean(settings?.immichBaseUrl || settings?.dawarichBaseUrl),
    hasForwardingAddress: mailAddress !== null,
    allowedSenders: senders,
    mailReminders: reminders !== null,
    notificationEmail: user?.notificationEmail ?? null,
  };
}

export async function loadReadinessContext(
  userId: string,
  isAdmin: boolean,
  now: Date = new Date()
): Promise<ReadinessContext> {
  const [instance, account] = await Promise.all([loadInstance(now), loadAccount(userId)]);
  return { now, userId, isAdmin, instance, account };
}
