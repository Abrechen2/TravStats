import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../db";
import { systemLogger } from "../../utils/logger";
import type { FlightChange } from "../flightAutoUpdate";
import { serverPushEnabled } from "../push/devices";
import { sendToRelay, type RelayPush, type RelayOutcome } from "../push/relayClient";
import { sealForDevice } from "../push/seal";
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
  deps: Deps
): Promise<void> {
  if (!(await serverPushEnabled())) return;
  const send = deps.send ?? sendToRelay;
  const now = deps.now ?? (() => new Date());
  const devices = await prisma.devicePush.findMany({
    where: { userId, [switchField]: true, apiToken: { revokedAt: null } },
  });

  for (const device of devices) {
    const locale: Locale = device.locale === "en" ? "en" : "de";
    const message = render(locale);
    if (!message) continue;

    let deliveryId: string;
    try {
      deliveryId = (
        await prisma.pushDelivery.create({ data: { apiTokenId: device.apiTokenId, eventKey } })
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
        apnsEnvironment: device.apnsEnvironment,
        ciphertext: sealForDevice(device.publicKey, plaintext),
        collapseId: flightId,
        lang: locale,
      });
    } catch {
      outcome = "failed";
    }

    if (outcome === "token-invalid") {
      await prisma.devicePush.deleteMany({ where: { apiTokenId: device.apiTokenId } });
    } else if (outcome !== "sent") {
      // Not delivered: free the claim so the next run can try again.
      await prisma.pushDelivery.deleteMany({ where: { id: deliveryId } });
    }
  }
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

/** The departure reminder (`key` 24h / 2h), once per flight and phone. */
export async function notifyReminder(
  userId: string,
  flight: FlightForMessage & { departureTime: Date },
  key: "24h" | "2h",
  deps: Deps = {}
): Promise<void> {
  await guarded("flight.reminder", () =>
    deliver(
      userId,
      "flight.reminder",
      flight.id,
      `reminder:${flight.id}:${key}`,
      "reminders",
      (locale) => reminderMessage(flight, key === "24h" ? 24 : 2, locale),
      deps
    )
  );
}
