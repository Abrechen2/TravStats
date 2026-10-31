import { prisma } from "../../../db";
import { dbLogger } from "../../../utils/logger";
import { hashPassword } from "../../../utils/password";
import { generateApiToken } from "../../../utils/apiTokens";
import { ensureAdminSettingsRow } from "../../adminSettingsRow";
import type { RelayOutcome, RelayPush } from "../../push/relayClient";
import { openOnPhone, phoneKeys } from "../../push/__tests__/phone";
import { notifyEntryReminder, notifyFlightChanged, notifyReminder } from "../dispatcher";

// The recheck right before a send has its own suite (reminders/eligibility); here the
// flight is a fixture with no row behind it.
jest.mock("../../reminders/eligibility", () => ({
  ...jest.requireActual<typeof import("../../reminders/eligibility")>(
    "../../reminders/eligibility"
  ),
  stillEligible: jest.fn(async () => true),
}));
import type { FlightForMessage } from "../messages";

/**
 * The dispatcher (TravStats#156): one sealed push per eligible phone, sent
 * once, never to a revoked pairing, never past a switch the person turned
 * off — and never an exception into the status job that called it.
 */
const flight: FlightForMessage = {
  id: "flight-1",
  flightNumber: "LH712",
  depIata: "FRA",
  arrIata: "HND",
  depTimezone: "Europe/Berlin",
  arrTimezone: "Asia/Tokyo",
  depTimeSemantics: "UTC",
  arrTimeSemantics: "UTC",
};
const gate = [{ field: "gate", oldValue: "A26", newValue: "B12", type: "changed" as const }];

let userId: string;
let adminId: number;

async function phone(
  opts: {
    flightChanges?: boolean;
    reminders?: boolean;
    locale?: string;
    revoked?: boolean;
    expiresAt?: Date | null;
    mutedTripIds?: string[];
  } = {}
) {
  const gen = await generateApiToken();
  const token = await prisma.apiToken.create({
    data: {
      userId,
      label: "phone",
      scope: "write",
      lookupHash: gen.lookupHash,
      hash: gen.hash,
      revokedAt: opts.revoked ? new Date() : null,
      expiresAt: opts.expiresAt ?? null,
    },
  });
  const keys = phoneKeys();
  await prisma.devicePush.create({
    data: {
      apiTokenId: token.id,
      userId,
      platform: "ios",
      token: `apns-${token.id.replace(/-/g, "")}`,
      apnsEnvironment: "production",
      publicKey: keys.pub,
      flightChanges: opts.flightChanges ?? true,
      reminders: opts.reminders ?? true,
      locale: opts.locale ?? "de",
      mutedTripIds: opts.mutedTripIds ?? [],
    },
  });
  return { tokenId: token.id, keys };
}

function recorder(outcome: RelayOutcome | (() => RelayOutcome) = "sent") {
  const pushes: RelayPush[] = [];
  const send = jest.fn(async (p: RelayPush) => {
    pushes.push(p);
    return typeof outcome === "function" ? outcome() : outcome;
  });
  return { pushes, send };
}

beforeAll(async () => {
  adminId = await ensureAdminSettingsRow();
  await prisma.user.deleteMany({ where: { username: "dispatcher_a" } });
  const u = await prisma.user.create({
    data: { username: "dispatcher_a", passwordHash: await hashPassword("password123") },
  });
  userId = u.id;
});

beforeEach(async () => {
  await prisma.reminderClaim.deleteMany({ where: { userId } });
  await prisma.devicePush.deleteMany({ where: { userId } });
  await prisma.apiToken.deleteMany({ where: { userId } });
  await prisma.adminSettings.update({ where: { id: adminId }, data: { pushEnabled: true } });
  await prisma.user.update({ where: { id: userId }, data: { isActive: true } });
});

afterAll(async () => {
  await prisma.adminSettings.update({ where: { id: adminId }, data: { pushEnabled: false } });
  await prisma.devicePush.deleteMany({ where: { userId } });
  await prisma.apiToken.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("notifyFlightChanged", () => {
  it("leaves apnsEnvironment out for an Android phone", async () => {
    await phone();
    await prisma.devicePush.updateMany({
      where: { userId },
      data: { platform: "android", apnsEnvironment: null },
    });
    const r = recorder();
    await notifyFlightChanged(userId, flight, gate, { pending: false }, { send: r.send });
    expect(r.pushes).toHaveLength(1);
    expect(r.pushes[0].platform).toBe("android");
    expect("apnsEnvironment" in r.pushes[0]).toBe(false);
  });

  it("sends each eligible phone a push only that phone can read", async () => {
    const p = await phone({ locale: "en" });
    const r = recorder();
    await notifyFlightChanged(userId, flight, gate, { pending: false }, { send: r.send });
    expect(r.pushes).toHaveLength(1);
    const push = r.pushes[0];
    expect(push).toMatchObject({
      platform: "ios",
      apnsEnvironment: "production",
      collapseId: "change:flight-1",
      lang: "en",
    });
    const plain = JSON.parse(openOnPhone(p.keys.priv, p.keys.pub, push.ciphertext));
    expect(plain).toMatchObject({
      v: 1,
      type: "flight.changed",
      title: "LH712: new gate",
      body: "B12 instead of A26",
      flightId: "flight-1",
    });
    expect(typeof plain.id).toBe("string");
    expect(new Date(plain.sentAt).toString()).not.toBe("Invalid Date");
  });

  it("sends the same change only once", async () => {
    await phone();
    const r = recorder();
    await notifyFlightChanged(userId, flight, gate, { pending: false }, { send: r.send });
    const error = jest.spyOn(dbLogger, "error");
    try {
      await notifyFlightChanged(userId, flight, gate, { pending: false }, { send: r.send });
      // The claim's unique violation IS the dedupe — handled, so not a logged error.
      expect(
        error.mock.calls.filter(
          ([e]) => (e as { operation?: string }).operation === "database_query_error"
        )
      ).toHaveLength(0);
    } finally {
      error.mockRestore();
    }
    expect(r.pushes).toHaveLength(1);
  });

  it("never reaches a revoked pairing or a phone that switched flight changes off", async () => {
    await phone({ revoked: true });
    await phone({ flightChanges: false });
    const r = recorder();
    await notifyFlightChanged(userId, flight, gate, { pending: false }, { send: r.send });
    expect(r.pushes).toHaveLength(0);
  });

  it("never reaches an expired pairing", async () => {
    await phone({ expiresAt: new Date(Date.now() - 60_000) });
    const live = await phone({ expiresAt: new Date(Date.now() + 86_400_000) });
    const r = recorder();
    await notifyFlightChanged(userId, flight, gate, { pending: false }, { send: r.send });
    expect(r.pushes).toHaveLength(1);
    expect(r.pushes[0].token).toBe(`apns-${live.tokenId.replace(/-/g, "")}`);
  });

  it("never reaches a deactivated user", async () => {
    await phone();
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
    const r = recorder();
    await notifyFlightChanged(userId, flight, gate, { pending: false }, { send: r.send });
    expect(r.send).not.toHaveBeenCalled();
  });

  it("does nothing while the admin has not switched push on", async () => {
    await phone();
    await prisma.adminSettings.update({ where: { id: adminId }, data: { pushEnabled: false } });
    const r = recorder();
    await notifyFlightChanged(userId, flight, gate, { pending: false }, { send: r.send });
    expect(r.send).not.toHaveBeenCalled();
    expect(await prisma.pushDelivery.count({ where: { device: { userId } } })).toBe(0);
  });

  it("sends nothing for a change nobody waits for", async () => {
    await phone();
    const r = recorder();
    await notifyFlightChanged(
      userId,
      flight,
      [{ field: "aircraft", oldValue: "A320", newValue: "A321", type: "changed" }],
      { pending: false },
      { send: r.send }
    );
    expect(r.send).not.toHaveBeenCalled();
  });

  it("marks a phone whose token the provider calls dead, and stops sending to it", async () => {
    const p = await phone();
    await notifyFlightChanged(
      userId,
      flight,
      gate,
      { pending: false },
      { send: recorder("token-invalid").send }
    );
    const row = await prisma.devicePush.findUnique({ where: { apiTokenId: p.tokenId } });
    expect(row?.tokenRejectedAt).not.toBeNull();
    const again = recorder();
    await notifyFlightChanged(userId, flight, gate, { pending: false }, { send: again.send });
    expect(again.send).not.toHaveBeenCalled();
  });

  it("frees the change for a later run when the relay failed", async () => {
    await phone();
    await notifyFlightChanged(
      userId,
      flight,
      gate,
      { pending: false },
      { send: recorder("failed").send }
    );
    const r = recorder();
    await notifyFlightChanged(userId, flight, gate, { pending: false }, { send: r.send });
    expect(r.pushes).toHaveLength(1);
  });

  it("never throws into the caller", async () => {
    await phone();
    const send = jest.fn(async () => {
      throw new Error("boom");
    });
    await expect(
      notifyFlightChanged(userId, flight, gate, { pending: false }, { send })
    ).resolves.toBeUndefined();
  });
});

describe("notifyReminder", () => {
  it("sends the reminder once, respecting the reminders switch", async () => {
    const on = await phone();
    await phone({ reminders: false });
    const r = recorder();
    const f = { ...flight, departureTime: new Date("2026-10-14T11:25:00.000Z") };
    await notifyReminder(userId, f, 24, { send: r.send });
    await notifyReminder(userId, f, 24, { send: r.send });
    expect(r.pushes).toHaveLength(1);
    // Its own collapse id: a reminder must not replace an unread change on the phone.
    expect(r.pushes[0].collapseId).toBe("reminder:flight-1");
    const plain = JSON.parse(openOnPhone(on.keys.priv, on.keys.pub, r.pushes[0].ciphertext));
    expect(plain).toMatchObject({
      type: "flight.reminder",
      title: "LH712: Abflug in 24 Stunden",
      body: "FRA → HND · 13:25 Ortszeit",
    });
  });

  it("does not repeat a flight reminder already pushed before the claim table (legacy push_deliveries)", async () => {
    const old = await phone();
    const fresh = await phone();
    await prisma.pushDelivery.create({
      data: { apiTokenId: old.tokenId, eventKey: `reminder:${flight.id}:24h` },
    });
    const r = recorder();
    const f = { ...flight, departureTime: new Date("2026-10-14T11:25:00.000Z") };
    await notifyReminder(userId, f, 24, { send: r.send });
    // Only the phone without a legacy delivery gets it; the other lead is unaffected.
    expect(r.pushes).toHaveLength(1);
    await notifyReminder(userId, f, 2, { send: r.send });
    expect(r.pushes).toHaveLength(3);
    expect(fresh.tokenId).not.toBe(old.tokenId);
  });

  it("a legacy delivery for an earlier departure does not mute a rescheduled flight", async () => {
    const p = await phone();
    await prisma.pushDelivery.create({
      data: {
        apiTokenId: p.tokenId,
        eventKey: `reminder:${flight.id}:24h`,
        sentAt: new Date("2026-10-10T00:00:00.000Z"),
      },
    });
    const r = recorder();
    await notifyReminder(
      userId,
      { ...flight, departureTime: new Date("2026-10-14T11:25:00.000Z") },
      24,
      { send: r.send, now: () => new Date("2026-10-13T11:30:00.000Z") }
    );
    expect(r.pushes).toHaveLength(1);
  });

  // forgejo#286: the trip page's "Erinnerungen für diese Reise" reaches the
  // server push. A muted trip's reminder stays home; another trip's goes; a
  // flight-change notice is not a reminder and ignores the mute.
  it("skips a phone that muted the flight's trip, and only for reminders", async () => {
    const muting = await phone({ mutedTripIds: ["trip-muted"] });
    const r = recorder();
    const departure = new Date("2026-10-14T11:25:00.000Z");

    await notifyReminder(
      userId,
      { ...flight, departureTime: departure, tripId: "trip-muted" },
      24,
      { send: r.send }
    );
    expect(r.pushes).toHaveLength(0);
    expect(await prisma.pushDelivery.count({ where: { apiTokenId: muting.tokenId } })).toBe(0);

    await notifyReminder(
      userId,
      { ...flight, id: "flight-2", departureTime: departure, tripId: "trip-other" },
      24,
      { send: r.send }
    );
    expect(r.pushes).toHaveLength(1);
    expect(r.pushes[0].collapseId).toBe("reminder:flight-2");

    await notifyFlightChanged(
      userId,
      { ...flight, tripId: "trip-muted" } as FlightForMessage,
      gate,
      { pending: false },
      { send: r.send }
    );
    expect(r.pushes).toHaveLength(2);
    expect(r.pushes[1].collapseId).toBe("change:flight-1");
  });

  it("mutes one phone without muting the account's other phone", async () => {
    await phone({ mutedTripIds: ["trip-muted"] });
    const other = await phone();
    const r = recorder();
    await notifyReminder(
      userId,
      { ...flight, departureTime: new Date("2026-10-14T11:25:00.000Z"), tripId: "trip-muted" },
      2,
      { send: r.send }
    );
    expect(r.pushes).toHaveLength(1);
    expect(r.pushes[0].token).toBe(`apns-${other.tokenId.replace(/-/g, "")}`);
  });

  it("pushes to EVERY paired phone once each, and a restart does not repeat it", async () => {
    const a = await phone();
    const b = await phone();
    const r = recorder();
    const f = { ...flight, departureTime: new Date("2026-10-14T11:25:00.000Z") };
    await notifyReminder(userId, f, 24, { send: r.send });
    expect(r.pushes.map((p) => p.token).sort()).toEqual(
      [a, b].map((p) => `apns-${p.tokenId.replace(/-/g, "")}`).sort()
    );
    await notifyReminder(userId, f, 24, { send: r.send });
    expect(r.pushes).toHaveLength(2);
  });

  it("a relay rejection marks THAT phone's token and spares the other phone", async () => {
    const dead = await phone();
    const live = await phone();
    const deadToken = `apns-${dead.tokenId.replace(/-/g, "")}`;
    const send = jest.fn(async (p: RelayPush): Promise<RelayOutcome> =>
      p.token === deadToken ? "token-invalid" : "sent"
    );
    const f = { ...flight, departureTime: new Date("2026-10-14T11:25:00.000Z") };
    await notifyReminder(userId, f, 24, { send });
    expect(
      (await prisma.devicePush.findUnique({ where: { apiTokenId: dead.tokenId } }))?.tokenRejectedAt
    ).not.toBeNull();
    expect(
      (await prisma.devicePush.findUnique({ where: { apiTokenId: live.tokenId } }))?.tokenRejectedAt
    ).toBeNull();
    // The rejected claim is freed, not kept as "sent".
    expect(
      await prisma.reminderClaim.count({
        where: { userId, channel: `push:${dead.tokenId}`, sentAt: { not: null } },
      })
    ).toBe(0);
  });

  it("a failed push frees the claim so the next run retries (within the lateness bound)", async () => {
    await phone();
    const f = { ...flight, departureTime: new Date("2026-10-14T11:25:00.000Z") };
    await notifyReminder(userId, f, 2, { send: recorder("failed").send });
    const r = recorder();
    await notifyReminder(userId, f, 2, { send: r.send });
    expect(r.pushes).toHaveLength(1);
  });

  it("carries the domain and entry id in the sealed payload for non-flight entries", async () => {
    const p = await phone();
    const r = recorder();
    await notifyEntryReminder(
      userId,
      {
        domain: "rail",
        entryId: "rail-1",
        tripId: null,
        hours: 24,
        anchorAt: new Date("2026-10-14T11:25:00.000Z"),
        anchorKey: "k",
        render: () => ({ title: "Berlin → Hamburg: Abfahrt in 24 Stunden", body: "ICE 1" }),
      },
      { send: r.send }
    );
    const plain = JSON.parse(openOnPhone(p.keys.priv, p.keys.pub, r.pushes[0].ciphertext));
    expect(plain).toMatchObject({ type: "rail.reminder", domain: "rail", entryId: "rail-1" });
    expect(plain.flightId).toBeUndefined();
  });
});
