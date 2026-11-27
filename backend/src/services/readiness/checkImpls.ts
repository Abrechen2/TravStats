/**
 * The evaluators and `appliesWhen` predicates of the first checks (spec §6),
 * one entry per catalogue id. The record is exhaustive on purpose: a check
 * added to `shared/readinessCatalogue.ts` without an evaluator here is a type
 * error (pattern: `DERIVE` in `services/sharing/shareTypes.ts`).
 *
 * Evaluators are pure functions of `ReadinessContext`. A check with no stored
 * result answers `unknown` — never `ready` and never `needsAction`.
 */
import type { ReadinessContext } from "./context";
import type { LastTest } from "../externalServices/types";
import type { CheckImpls, Evaluation } from "./types";
import { ENTRY_CHECK_IMPLS, PROBLEM_CHECK_IMPLS } from "./problemChecks";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A scheduled backup older than the schedule's own rhythm plus two days has been missed. */
const BACKUP_MAX_AGE_DAYS = { daily: 2, weekly: 9, monthly: 33 } as const;
/** Fewer free bytes than this, or a smaller free share, is "nearly full". */
export const DISK_MIN_FREE_BYTES = 1024 ** 3;
export const DISK_MIN_FREE_FRACTION = 0.05;

const ready = (checkedAt: Date | null = null): Evaluation => ({ status: "ready", checkedAt });
const needsAction = (checkedAt: Date | null = null): Evaluation => ({
  status: "needsAction",
  checkedAt,
});
const unknown: Evaluation = { status: "unknown", checkedAt: null };

const always = (): boolean => true;
const parseAt = (iso: string): Date => new Date(iso);

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * One failed stored test is a fault; all passing is ready; none stored says nothing.
 * A ready answer is only as fresh as its OLDEST test, so one retested provider cannot
 * keep the expired results of the others looking current.
 */
function fromTests(tests: readonly LastTest[]): Evaluation {
  if (tests.length === 0) return unknown;
  const times = (list: readonly LastTest[]): number[] => list.map((t) => parseAt(t.at).getTime());
  const failed = tests.filter((t) => !t.ok);
  if (failed.length > 0) return needsAction(new Date(Math.max(...times(failed))));
  return ready(new Date(Math.min(...times(tests))));
}

function travtrackInUse(ctx: ReadinessContext): boolean {
  return ctx.instance.travtrackOffered && ctx.account.locationProvider === "travtrack";
}

export const CHECK_IMPLS: CheckImpls = {
  ...PROBLEM_CHECK_IMPLS,
  ...ENTRY_CHECK_IMPLS,
  "admin.smtp": {
    appliesWhen: always,
    evaluate: ({ instance }) => {
      if (!instance.smtp?.enabled) return needsAction();
      const test = instance.smtpTest;
      if (!test) return unknown;
      return test.ok ? ready(parseAt(test.at)) : needsAction(parseAt(test.at));
    },
  },
  "admin.publicUrl": {
    // An instance with no public address has nothing to be wrong; it is reachable on its LAN.
    appliesWhen: ({ instance }) => instance.publicUrl !== null,
    evaluate: ({ instance }) => {
      if (instance.publicUrl === null || !isHttpUrl(instance.publicUrl)) return needsAction();
      const check = instance.publicUrlCheck;
      // A result for another address is no evidence for this one.
      if (!check || check.url !== instance.publicUrl) return unknown;
      return check.ok ? ready(check.at) : needsAction(check.at);
    },
  },
  "admin.backup": {
    appliesWhen: always,
    evaluate: ({ instance, now }) => {
      const last = instance.latestScheduledBackup;
      if (!last) return unknown;
      if (last.status === "failed") return needsAction(last.at);
      const maxAge = BACKUP_MAX_AGE_DAYS[instance.backupInterval] * DAY_MS;
      return now.getTime() - last.at.getTime() > maxAge ? needsAction(last.at) : ready(last.at);
    },
  },
  "admin.disk": {
    appliesWhen: always,
    evaluate: ({ instance, now }) => {
      const disk = instance.disk;
      if (!disk) return unknown;
      const low =
        disk.freeBytes < DISK_MIN_FREE_BYTES || disk.freeFraction < DISK_MIN_FREE_FRACTION;
      return low ? needsAction(now) : ready(now);
    },
  },
  "admin.offsite": {
    appliesWhen: always,
    evaluate: ({ instance }) => (instance.offsiteConfigured ? ready() : needsAction()),
  },
  "admin.recoveryKey": {
    appliesWhen: ({ instance }) => instance.offsiteConfigured,
    evaluate: ({ instance }) => (instance.recoveryKeyConfirmed ? ready() : needsAction()),
  },
  "admin.keySwapInterrupted": {
    appliesWhen: ({ instance }) => instance.keySwapInterrupted,
    evaluate: () => needsAction(),
  },
  "admin.providerKeys": {
    // Only providers the admin has tried are judged; an untouched one is not a fault.
    appliesWhen: ({ instance }) => instance.providerTests.size > 0,
    evaluate: ({ instance }) => fromTests([...instance.providerTests.values()]),
  },
  "admin.bookingMailbox": {
    appliesWhen: ({ instance }) => instance.instanceMailbox !== null,
    evaluate: ({ instance }) => {
      const m = instance.instanceMailbox;
      if (!m) return unknown;
      if (m.lastErrorAt && (!m.lastOkAt || m.lastErrorAt > m.lastOkAt)) {
        return needsAction(m.lastErrorAt);
      }
      return m.lastOkAt ? ready(m.lastOkAt) : unknown;
    },
  },
  "user.domains": {
    appliesWhen: always,
    // The stored list has no "chosen" marker, so a choice shows as a list other than the
    // default, or as entries that prove the account uses the default on purpose.
    evaluate: ({ account }) => {
      const onlyDefault =
        account.enabledDomains.length === 1 && account.enabledDomains[0] === "flight";
      return !onlyDefault || account.hasFlights ? ready() : needsAction();
    },
  },
  "user.home": {
    appliesWhen: travtrackInUse,
    evaluate: ({ account }) => (account.hasHome ? ready() : needsAction()),
  },
  "user.phonePaired": {
    appliesWhen: travtrackInUse,
    evaluate: ({ account }) => (account.hasPairedDevice ? ready() : needsAction()),
  },
  "user.firstPosition": {
    appliesWhen: travtrackInUse,
    evaluate: ({ account }) => (account.hasRecordedPosition ? ready() : needsAction()),
  },
  "user.apiKeys": {
    appliesWhen: ({ account }) => account.tests.size > 0,
    evaluate: ({ account }) => fromTests([...account.tests.values()]),
  },
  "user.mailForwarding": {
    appliesWhen: ({ instance }) => instance.instanceMailbox !== null,
    evaluate: ({ account }) =>
      account.hasForwardingAddress && account.allowedSenders > 0 ? ready() : needsAction(),
  },
  "user.notificationEmail": {
    appliesWhen: ({ account }) => account.mailReminders,
    evaluate: ({ account }) => (account.notificationEmail ? ready() : needsAction()),
  },
};
