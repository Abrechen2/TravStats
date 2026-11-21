import request from "supertest";

import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { securityLogger } from "../../utils/logger";
import app from "../../index";

/**
 * forgejo#415 N6: deleting one's own account withdraws every connection with a
 * person on another server through the existing withdrawal path BEFORE the
 * rows that address those servers are gone, and writes an audit event. The
 * federation transport itself is covered by its own suites; here only that
 * the path is taken, in that order, and not for a refused deletion.
 */
const seenUserWhenEnding: Array<boolean> = [];
const mockEndConnection = jest.fn(async (userId: string, _id: string) => {
  seenUserWhenEnding.push((await prisma.user.count({ where: { id: userId } })) === 1);
  return {};
});
jest.mock("../../services/sharing/federation/connections/actions", () => ({
  ...jest.requireActual("../../services/sharing/federation/connections/actions"),
  endConnection: (userId: string, id: string) => mockEndConnection(userId, id),
}));
const mockRunDeliveries = jest.fn(async () => ({ sent: 0, failed: 0, parked: 0, dropped: 0 }));
jest.mock("../../services/sharing/federation/outbox", () => ({
  ...jest.requireActual("../../services/sharing/federation/outbox"),
  runDeliveries: () => mockRunDeliveries(),
}));

const NAMES = ["delPeersUser", "delPeersAdmin", "delPeersAdmin2"];

async function makeUser(username: string, admin = false): Promise<string> {
  await prisma.user.deleteMany({ where: { username } });
  const user = await prisma.user.create({
    data: { username, passwordHash: await hashPassword("password123"), isAdmin: admin },
  });
  return user.id;
}

async function connect(userId: string, n: number, state: string): Promise<string> {
  const row = await prisma.remoteShareAccount.create({
    data: {
      userId,
      origin: `https://peer${n}.example`,
      channel: `ch-${userId}-${n}`,
      localChannel: `lc-${userId}-${n}`,
      username: `far${n}`,
      displayName: `Far ${n}`,
      state,
    },
  });
  return row.id;
}

const del = (id: string, confirmation = NAMES[0]): request.Test =>
  request(app)
    .delete("/api/v1/auth/me")
    .set("Cookie", `auth_token=${generateToken(id)}`)
    .send({ password: "password123", confirmation });

describe("self-delete tells federated peers and leaves an audit event (forgejo#415)", () => {
  beforeEach(() => {
    mockEndConnection.mockClear();
    mockRunDeliveries.mockClear();
    seenUserWhenEnding.length = 0;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: NAMES } } });
    await prisma.$disconnect();
  });

  it("withdraws each open connection while the account still exists, then deletes it", async () => {
    const audit = jest.spyOn(securityLogger, "info");
    const id = await makeUser(NAMES[0]);
    const open = await connect(id, 1, "active");
    const pending = await connect(id, 2, "pending_out");
    await connect(id, 3, "revoked");

    const res = await del(id);

    expect(res.status).toBe(200);
    expect(mockEndConnection.mock.calls.map((c) => c[1]).sort()).toEqual([open, pending].sort());
    expect(seenUserWhenEnding).toEqual([true, true]);
    expect(mockRunDeliveries).toHaveBeenCalledTimes(1);
    expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.remoteShareAccount.count({ where: { userId: id } })).toBe(0);
    const event = audit.mock.calls
      .map((c) => c[0] as { context?: { eventType?: string; userId?: string; self?: boolean } })
      .find((e) => e.context?.eventType === "account_deleted");
    expect(event?.context).toMatchObject({ userId: id, self: true, peersWithdrawn: 2 });
    audit.mockRestore();
  });

  it("still deletes when a peer cannot be told", async () => {
    const id = await makeUser(NAMES[0]);
    await connect(id, 1, "active");
    mockEndConnection.mockRejectedValueOnce(new Error("peer down"));
    const res = await del(id);
    expect(res.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
  });

  it("two last admins deleting at once: the refused one keeps every connection", async () => {
    await prisma.user.updateMany({ where: { isAdmin: true }, data: { isAdmin: false } });
    const a = await makeUser(NAMES[1], true);
    const b = await makeUser(NAMES[2], true);
    const ca = await connect(a, 1, "active");
    const cb = await connect(b, 2, "active");
    const [ra, rb] = await Promise.all([del(a, NAMES[1]), del(b, NAMES[2])]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    const kept = ra.status === 409 ? { id: a, conn: ca } : { id: b, conn: cb };
    expect(mockEndConnection.mock.calls.map((c) => c[1])).not.toContain(kept.conn);
    const survivor = await prisma.user.findUnique({ where: { id: kept.id } });
    expect(survivor).toMatchObject({ isAdmin: true, isActive: true });
  });

  it("does not touch the connections of a last admin it refuses", async () => {
    await prisma.user.updateMany({ where: { isAdmin: true }, data: { isAdmin: false } });
    const id = await makeUser(NAMES[0], true);
    await connect(id, 1, "active");
    const res = await del(id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DELETE_LAST_ADMIN");
    expect(mockEndConnection).not.toHaveBeenCalled();
    expect(await prisma.remoteShareAccount.count({ where: { userId: id, state: "active" } })).toBe(
      1
    );
  });
});
