import { Client } from "pg";

import { prisma } from "../../../db";
import { pruneSyncChanges, resetSyncHistory } from "../state";
import { createFlight, drainFeed, readFeed, registerUser, wipe } from "./syncFixtures";

/**
 * `GET /sync/changes` end to end: the full read, the delta, tombstones,
 * ownership, domain scope, retention, and the case the cursor design exists
 * for — transactions that commit in a different order than they started.
 */

const ids = (items: Array<{ entity: string; id: string; op: string }>, op: string) =>
  items.filter((item) => item.op === op).map((item) => `${item.entity}:${item.id}`);

describe("GET /api/v1/sync/changes", () => {
  beforeEach(wipe);
  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  it("starts with a full read of the account, then hands out only what changed", async () => {
    const user = await registerUser("sync-feed-1");
    const kept = await createFlight(user.id, { notes: "alt" });
    const trip = await prisma.trip.create({ data: { userId: user.id, name: "Lissabon" } });

    const first = await drainFeed(user);
    expect(ids(first.items, "upsert")).toEqual(
      expect.arrayContaining([`flight:${kept.id}`, `trip:${trip.id}`])
    );
    const record = first.items.find((item) => item.id === kept.id);
    expect(record?.version).toBe(kept.updatedAt.toISOString());
    expect(record?.record).not.toHaveProperty("actualRoute");

    const quiet = await drainFeed(user, first.cursor);
    expect(quiet.items).toEqual([]);

    await prisma.flight.update({ where: { id: kept.id }, data: { notes: "neu" } });
    const added = await createFlight(user.id);
    await prisma.trip.delete({ where: { id: trip.id } });

    const delta = await drainFeed(user, quiet.cursor);
    expect(ids(delta.items, "upsert").sort()).toEqual(
      [`flight:${added.id}`, `flight:${kept.id}`].sort()
    );
    expect(ids(delta.items, "delete")).toEqual([`trip:${trip.id}`]);
    const updated = delta.items.find((item) => item.id === kept.id);
    expect(updated?.record?.notes).toBe("neu");
  });

  it("pages a long feed without losing or repeating anything", async () => {
    const user = await registerUser("sync-feed-2");
    const start = await drainFeed(user);
    const made: string[] = [];
    for (let i = 0; i < 7; i += 1) made.push((await createFlight(user.id)).id);

    const paged = await drainFeed(user, start.cursor, 2);

    expect(paged.items.map((item) => item.id).sort()).toEqual([...made].sort());
  });

  it("never shows another account's changes", async () => {
    const me = await registerUser("sync-feed-3a");
    const other = await prisma.user.create({
      data: { username: "sync-feed-3b", passwordHash: "x" },
    });
    const start = await drainFeed(me);
    await createFlight(other.id);

    expect((await drainFeed(me, start.cursor)).items).toEqual([]);
    expect((await drainFeed(me)).items.filter((item) => item.entity === "flight")).toEqual([]);
  });

  it("holds back a change whose transaction began earlier until that transaction commits", async () => {
    // Transaction A takes its id first and commits LAST; B starts after A and
    // commits first. A cursor built from commit order, a clock or a sequence
    // would move past A's row while it was still invisible and never return.
    const user = await registerUser("sync-feed-4");
    const start = await drainFeed(user);
    const slow = new Client({ connectionString: process.env.DATABASE_URL });
    await slow.connect();
    try {
      await slow.query("BEGIN");
      const slowRow = await slow.query<{ id: string }>(
        `INSERT INTO flights (id, user_id, dep_lat, dep_lon, arr_lat, arr_lon, updated_at)
         VALUES (gen_random_uuid()::text, $1, 1, 1, 2, 2, now()) RETURNING id`,
        [user.id]
      );
      const fast = await createFlight(user.id);

      const during = await drainFeed(user, start.cursor);
      expect(during.items.map((item) => item.id)).not.toContain(fast.id);

      await slow.query("COMMIT");
      const after = await drainFeed(user, during.cursor);
      expect(after.items.map((item) => item.id).sort()).toEqual(
        [fast.id, slowRow.rows[0].id].sort()
      );
    } finally {
      await slow.query("ROLLBACK").catch(() => undefined);
      await slow.end();
    }
  });

  it("does not hand out records of a hidden domain, and refuses a cursor from another scope", async () => {
    const user = await registerUser("sync-feed-5", ["flight"]);
    const start = await drainFeed(user);
    await prisma.cruise.create({ data: { userId: user.id, routeName: "Nordkap" } });
    expect((await drainFeed(user, start.cursor)).items).toEqual([]);

    // Switching cruises on cannot be patched forward: the cruise never
    // changed, so no change row would ever bring it. (Rail would do, but it
    // also waits on the instance's beta switch.)
    await prisma.userSettings.update({
      where: { userId: user.id },
      data: { enabledDomains: ["flight", "cruise"] },
    });
    const refused = await readFeed(user, start.cursor);
    expect(refused.status).toBe(410);
    expect(refused.body).toMatchObject({ code: "SYNC_RESYNC_REQUIRED", reason: "scopeChanged" });
  });

  it("refuses a cursor older than the retention horizon instead of answering with holes", async () => {
    const user = await registerUser("sync-feed-6");
    const old = await drainFeed(user);
    const doomed = await createFlight(user.id);
    await prisma.flight.delete({ where: { id: doomed.id } });
    await prisma.$executeRaw`
      UPDATE sync_changes SET created_at = created_at - interval '400 days' WHERE user_id = ${user.id}`;

    await pruneSyncChanges();

    const refused = await readFeed(user, old.cursor);
    expect(refused.status).toBe(410);
    expect(refused.body.reason).toBe("cursorExpired");
    const fresh = await drainFeed(user);
    expect(fresh.items.map((item) => item.id)).not.toContain(doomed.id);
    expect((await readFeed(user, fresh.cursor)).status).toBe(200);
  });

  it("refuses every cursor minted before a restore", async () => {
    const user = await registerUser("sync-feed-7");
    const before = await drainFeed(user);

    await resetSyncHistory("test");

    const refused = await readFeed(user, before.cursor);
    expect(refused.status).toBe(410);
    expect(refused.body.reason).toBe("epochChanged");
  });

  it("answers 400 for a cursor it did not mint, and 401 without a session", async () => {
    const user = await registerUser("sync-feed-8");
    expect((await readFeed(user, "not-a-cursor")).status).toBe(400);
    expect((await readFeed({ id: user.id, cookie: [] })).status).toBe(401);
  });
});
