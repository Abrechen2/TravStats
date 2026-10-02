import { prisma } from "../../db";
import { calculateNextApiCheckAt } from "../../utils/smartCheckSchedule";
import { backfillNextApiCheckAt } from "../nextApiCheckBackfill";

/**
 * The start-up pass over scheduled flights (TravStats#156). The push
 * checkpoints (D-24h, D-3h, every 15 min) only reach a flight when its next
 * check is computed — and a flight stored before that change still carries
 * its old D-30min check. The pass pulls such a check earlier, never later,
 * and is safe to run on every start.
 */
const H = 60 * 60 * 1000;
const NOW = new Date("2026-10-02T12:00:00.000Z");
const at = (h: number) => new Date(NOW.getTime() + h * H);

describe("backfillNextApiCheckAt", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "apicheckbackfill" } });
    const user = await prisma.user.create({
      data: { username: "apicheckbackfill", passwordHash: "x" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  function flight(over: Record<string, unknown>) {
    return prisma.flight.create({
      data: {
        userId,
        flightNumber: "BF1",
        depIata: "FRA",
        arrIata: "JFK",
        depLat: 50.03,
        depLon: 8.57,
        arrLat: 40.64,
        arrLon: -73.78,
        status: "scheduled",
        ...over,
      },
    });
  }
  const nextCheck = async (id: string) =>
    (await prisma.flight.findUnique({ where: { id } }))?.nextApiCheckAt?.toISOString() ?? null;

  it("pulls an old D-30min check of a future flight forward to the new first checkpoint", async () => {
    const dep = at(10 * 24);
    const old = await flight({
      departureTime: dep,
      arrivalTime: at(10 * 24 + 8),
      nextApiCheckAt: new Date(dep.getTime() - 0.5 * H),
    });
    await backfillNextApiCheckAt(NOW);
    expect(await nextCheck(old.id)).toBe(new Date(dep.getTime() - 24 * H).toISOString());
  });

  it("never moves a check later", async () => {
    const soon = await flight({
      departureTime: at(48),
      arrivalTime: at(56),
      nextApiCheckAt: at(1),
    });
    await backfillNextApiCheckAt(NOW);
    expect(await nextCheck(soon.id)).toBe(at(1).toISOString());
  });

  it("still fills a missing check, as before", async () => {
    const missing = await flight({ departureTime: at(72), arrivalTime: at(80) });
    await backfillNextApiCheckAt(NOW);
    expect(await nextCheck(missing.id)).toBe(
      calculateNextApiCheckAt(at(72), at(80), "scheduled", "BF1", NOW)?.toISOString()
    );
  });

  it("leaves flights that already departed, and other statuses, alone", async () => {
    const departed = await flight({
      departureTime: at(-1),
      arrivalTime: at(7),
      nextApiCheckAt: at(6),
    });
    const cancelled = await flight({
      status: "cancelled",
      departureTime: at(48),
      arrivalTime: at(56),
      nextApiCheckAt: at(47.5),
    });
    await backfillNextApiCheckAt(NOW);
    expect(await nextCheck(departed.id)).toBe(at(6).toISOString());
    expect(await nextCheck(cancelled.id)).toBe(at(47.5).toISOString());
  });

  it("changes nothing on a second run, across several batches", async () => {
    const rows = await Promise.all(
      [5, 6, 7].map((d) =>
        flight({
          departureTime: at(d * 24),
          arrivalTime: at(d * 24 + 2),
          nextApiCheckAt: at(d * 24 - 0.5),
        })
      )
    );
    await backfillNextApiCheckAt(NOW, { batchSize: 2 });
    const first = await Promise.all(rows.map((r) => nextCheck(r.id)));
    expect(first).toEqual([5, 6, 7].map((d) => at(d * 24 - 24).toISOString()));
    const second = await backfillNextApiCheckAt(NOW, { batchSize: 2 });
    expect(await Promise.all(rows.map((r) => nextCheck(r.id)))).toEqual(first);
    expect(second.pulledEarlier).toBe(0);
  });
  it("does not skip a row when the last row of a full page stops matching after its update", async () => {
    // Departed, no check yet: matches only through `nextApiCheckAt: null`, and
    // stops matching once the pass fills it. Ids sort before every random one.
    const ids = [1, 2, 3].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
    await prisma.flight.deleteMany({ where: { id: { in: ids } } });
    await Promise.all(ids.map((id) => flight({ id, departureTime: at(-1), arrivalTime: at(7) })));
    await backfillNextApiCheckAt(NOW, { batchSize: 2 });
    const filled = await Promise.all(ids.map((id) => nextCheck(id)));
    expect(filled).toEqual(ids.map(() => at(6).toISOString()));
  });
});
