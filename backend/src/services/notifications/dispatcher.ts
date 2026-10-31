import { Prisma } from "../../prisma";
import { expectingUniqueConflict, prisma } from "../../db";
import { systemLogger } from "../../utils/logger";
import type { FlightChange } from "../flightAutoUpdate";
import { serverPushEnabled } from "../push/devices";
import { sendToRelay, type RelayPush, type RelayOutcome } from "../push/relayClient";
import { sealForDevice } from "../push/seal";
import { claimReminder, markSent, releaseClaim } from "../reminders/claims";
import { stillEligible } from "../reminders/eligibility";
import type { ReminderDomain } from "../reminders/prefs";
import {
  flightChangedMessage,
  reminderMessage,
  type FlightForMessage,
  type Locale,
  type Message,
} from "./messages";

/**
 * Turns flight events into pushes for the user's paired phones (TravStats#156).
 *
 * Per phone: the switch must be on and the pairing not revoked; the event is
 * claimed in `push_deliveries` first (the unique row is the dedupe — the
 * 5-minute status job must never send the same change twice); the text is
 * sealed for that phone alone and handed to the relay. A dead token removes
 * the phone; any other failure frees the claim so a later run may try again.
 *
 * Nothing here throws into the caller: the status job and the reminder cron
 * must never fail because of a push.
 */
type Deps = { send?: (push: RelayPush) => Promise<RelayOutcome>; now?: () => Date };
type Kind = "flight.changed" | "flight.reminder";
const COLLAPSE: Record<Kind, string> = {
  "flight.changed": "change",
  "flight.reminder": "reminder",
};

/** Fields that can reach the phone as words (see messages.ts); the rest never make an event. */
const NOTIFIED_FIELDS = new Set([
  "gate",
  "terminal",
  "departureTime",
  "arrivalTime",
  "depIata",
  "arrIata",
  "status",
]);

function changeKey(
  flightId: string,
  changes: readonly FlightChange[],
  opts: { cancelled?: boolean; diverted?: boolean }
): string {
  const parts = changes
    .filter((c) => NOTIFIED_FIELDS.has(c.field))
    .map((c) => `${c.field}:${String(c.newValue ?? "")}`)
    .sort();
  if (opts.cancelled) parts.push("cancelled");
  if (opts.diverted) parts.push("diverted");
  return `flight:${flightId}|${parts.join("|")}`;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

async function deliver(
  userId: string,
  kind: Kind,
  flightId: string,
  eventKey: string,
  switchField: "flightChanges" | "reminders",
  render: (locale: Locale) => Message | null,
  deps: Deps,
  /** A reminder's trip: a phone that muted it is skipped (forgejo#286). */
  mutedBy: string | null = null
): Promise<void> {
  if (!(await serverPushEnabled())) return;
  const send = deps.send ?? sendToRelay;
  const now = deps.now ?? (() => new Date());
  const at = now();
  // Only a pairing that could still sign in: not revoked, not expired, and
  // its owner not deactivated (the auth middleware refuses all three).
  const devices = await prisma.devicePush.findMany({
    where: {
      userId,
      [switchField]: true,
      ...(mutedBy !== null && { NOT: { mutedTripIds: { has: mutedBy } } }),
      tokenRejectedAt: null,
      user: { isActive: true },
      apiToken: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: at } }] },
    },
  });

  for (const device of devices) {
    const locale: Locale = device.locale === "en" ? "en" : "de";
    const message = render(locale);
    if (!message) continue;

    let deliveryId: string;
    try {
      deliveryId = (
        await expectingUniqueConflict("PushDelivery", () =>
          prisma.pushDelivery.create({ data: { apiTokenId: device.apiTokenId, eventKey } })
        )
      ).id;
    } catch (err) {
      if (isUniqueViolation(err)) continue; // already told this phone
      throw err;
    }

    const plaintext = JSON.stringify({
      v: 1,
      type: kind,
      id: deliveryId,
      title: message.title,
      body: message.body,
      flightId,
      sentAt: now().toISOString(),
    });
    let outcome: RelayOutcome;
    try {
      outcome = await send({
        platform: device.platform === "android" ? "android" : "ios",
        token: device.token,
        ...(device.apnsEnvironment ? { apnsEnvironment: device.apnsEnvironment } : {}),
        ciphertext: sealForDevice(device.publicKey, plaintext),
        // Per kind: a reminder must not replace an unread change (or the
        // other way round). A flight id is a UUID, so this stays well under
        // the relay's and APNs' 64 characters.
        collapseId: `${COLLAPSE[kind]}:${flightId}`,
        lang: locale,
      });
    } catch {
      outcome = "failed";
    }

    if (outcome === "token-invalid") {
      await markTokenRejected(device.apiTokenId, device.token);
    } else if (outcome !== "sent") {
      // Not delivered: free the claim so the next run can try again.
      await prisma.pushDelivery.deleteMany({ where: { id: deliveryId } });
    }
  }
}

/**
 * The relay named this phone's token dead. The row stays, marked, so the
 * settings read can say "token_rejected" and the phone knows to schedule its
 * own reminders; a registration with a different token clears the mark.
 */
async function markTokenRejected(apiTokenId: string, token: string): Promise<void> {
  // Matched on the token too: a registration that replaced it while the send was in flight
  // must not inherit the old token's rejection.
  await prisma.devicePush.updateMany({
    where: { apiTokenId, token },
    data: { tokenRejectedAt: new Date() },
  });
}

async function guarded(what: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (err) {
    systemLogger.warn({
      operation: "push_dispatch",
      message: `${what} failed: ${(err as Error)?.message ?? err}`,
    });
  }
}

/** A detected change of a flight (applied, or waiting for confirmation when `pending`). */
export async function notifyFlightChanged(
  userId: string,
  flight: FlightForMessage,
  changes: readonly FlightChange[],
  opts: { pending: boolean; cancelled?: boolean; diverted?: boolean },
  deps: Deps = {}
): Promise<void> {
  await guarded("flight.changed", () =>
    deliver(
      userId,
      "flight.changed",
      flight.id,
      changeKey(flight.id, changes, opts),
      "flightChanges",
      (locale) => flightChangedMessage(flight, changes, opts, locale),
      deps
    )
  );
}

/** A reminder for one entry of any domain, as the dispatcher needs it. */
export interface EntryReminder {
  domain: ReminderDomain;
  entryId: string;
  /** Lodging only: put into the push data as `lodgingId` when set. */
  lodgingId?: string;
  /** A phone that muted this trip is skipped (forgejo#286). */
  tripId: string | null;
  hours: number;
  /** The entry's time as the finder read it; the claim re-arms when it moves. */
  anchorAt: Date;
  /** See `stillEligible`: the entry must still carry this key right before the send. */
  anchorKey: string;
  render: (locale: Locale) => Message | null;
}

/**
 * The reminder push: to EVERY paired phone with push on, once per phone.
 * Dedupe is the durable claim `push:<device>` per account, domain, entry and
 * lead (`reminder_claims`, lease and re-arm rules in `reminders/claims.ts`),
 * so a restart or a second worker cannot send twice. The entry and the
 * account's settings are re-read right before the send.
 */
export async function notifyEntryReminder(
  userId: string,
  entry: EntryReminder,
  deps: Deps = {}
): Promise<void> {
  await guarded(`${entry.domain}.reminder`, async () => {
    if (!(await serverPushEnabled())) return;
    const send = deps.send ?? sendToRelay;
    const now = deps.now ?? (() => new Date());
    const at = now();
    const devices = await prisma.devicePush.findMany({
      where: {
        userId,
        reminders: true,
        tokenRejectedAt: null,
        ...(entry.tripId !== null && { NOT: { mutedTripIds: { has: entry.tripId } } }),
        user: { isActive: true },
        apiToken: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: at } }] },
      },
    });
    if (devices.length === 0) return;
    const eligible = await stillEligible({
      userId,
      domain: entry.domain,
      entryId: entry.entryId,
      hours: entry.hours,
      channel: "app",
      anchorKey: entry.anchorKey,
    });
    if (!eligible) return;

    for (const device of devices) {
      const locale: Locale = device.locale === "en" ? "en" : "de";
      const message = entry.render(locale);
      if (!message) continue;
      // Transition: before the claim table, flight reminders were deduped on
      // push_deliveries (`reminder:<flightId>:24h|2h`, deleted again when a send failed, so a
      // row means "sent"). A reminder pushed before the deploy must not go out again inside
      // the new due window. Looked up rather than backfilled: no migration over a table of
      // unbounded size, and the rows age out with their flights.
      if (entry.domain === "flight" && (entry.hours === 24 || entry.hours === 2)) {
        // Anchor-aware: only a delivery that falls in THIS anchor's due window counts. One sent
        // for an earlier departure time (the flight was moved since) must not mute the new one,
        // as the claim's re-arm would not.
        const windowStart = new Date(entry.anchorAt.getTime() - (entry.hours + 2) * 3_600_000);
        const legacy = await prisma.pushDelivery.findFirst({
          where: {
            apiTokenId: device.apiTokenId,
            eventKey: `reminder:${entry.entryId}:${entry.hours}h`,
            sentAt: { gte: windowStart },
          },
          select: { id: true },
        });
        if (legacy) continue;
      }
      const claim = await claimReminder(
        {
          userId,
          domain: entry.domain,
          entryId: entry.entryId,
          leadHours: entry.hours,
          channel: `push:${device.apiTokenId}`,
        },
        entry.anchorAt,
        at
      );
      if (!claim) continue; // already told this phone (or another worker has it)

      const plaintext = JSON.stringify({
        v: 1,
        type: `${entry.domain}.reminder`,
        id: claim.id,
        title: message.title,
        body: message.body,
        domain: entry.domain,
        entryId: entry.entryId,
        ...(entry.domain === "flight" && { flightId: entry.entryId }),
        ...(entry.lodgingId !== undefined && { lodgingId: entry.lodgingId }),
        sentAt: at.toISOString(),
      });
      let outcome: RelayOutcome;
      try {
        outcome = await send({
          platform: device.platform === "android" ? "android" : "ios",
          token: device.token,
          ...(device.apnsEnvironment ? { apnsEnvironment: device.apnsEnvironment } : {}),
          ciphertext: sealForDevice(device.publicKey, plaintext),
          collapseId: `reminder:${entry.entryId}`.slice(0, 64),
          lang: locale,
        });
      } catch {
        outcome = "failed";
      }
      if (outcome === "sent") {
        await markSent(claim, now());
      } else {
        if (outcome === "token-invalid") await markTokenRejected(device.apiTokenId, device.token);
        await releaseClaim(claim);
      }
    }
  });
}

/** The flight departure reminder, `hours` before the departure. */
export async function notifyReminder(
  userId: string,
  flight: FlightForMessage & { departureTime: Date; tripId?: string | null },
  hours: number,
  deps: Deps = {}
): Promise<void> {
  await notifyEntryReminder(
    userId,
    {
      domain: "flight",
      entryId: flight.id,
      tripId: flight.tripId ?? null,
      hours,
      anchorAt: flight.departureTime,
      anchorKey: flight.departureTime.toISOString(),
      render: (locale) => reminderMessage(flight, hours, locale),
    },
    deps
  );
}
