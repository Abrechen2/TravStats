import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { generateApiToken } from "../../../utils/apiTokens";
import { ensureAdminSettingsRow } from "../../adminSettingsRow";
import type { RelayOutcome, RelayPush } from "../../push/relayClient";
import { openOnPhone, phoneKeys } from "../../push/__tests__/phone";
import { notifyFlightChanged, notifyReminder } from "../dispatcher";
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
    await notifyFlightChanged(userId, flight, gate, { pending: false }, { send: r.send });
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

  it("forgets a phone whose token the provider calls dead", async () => {
    const p = await phone();
    await notifyFlightChanged(
      userId,
      flight,
      gate,
      { pending: false },
      { send: recorder("token-invalid").send }
    );
    expect(await prisma.devicePush.findUnique({ where: { apiTokenId: p.tokenId } })).toBeNull();
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
    await notifyReminder(userId, f, "24h", { send: r.send });
    await notifyReminder(userId, f, "24h", { send: r.send });
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
});
