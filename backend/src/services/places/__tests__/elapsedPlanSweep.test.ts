import { prisma } from "../../../db";
import { hasElapsedPlan, isEffectivelyVisited } from "../../../shared/placeCounting";
import { decorate } from "../../../routes/places";
import { sweepElapsedPlannedVisits } from "../elapsedPlanSweep";

/**
 * A place stays on the wishlist when its planned visit's date passes
 * (tester feedback, 2026-11-08). The predicate answers reads at once, the sweep
 * persists the flag — and neither may undo an explicit unmark or a curated
 * checklist state.
 */
const USER = "elapsedplansweep";
const NOW = new Date("2026-11-09T12:00:00.000Z");
const DAY = 86_400_000;
const PAST = new Date(NOW.getTime() - 3 * DAY);
const PLANNED_AT = new Date(NOW.getTime() - 60 * DAY);

describe("elapsed planned visit makes a place visited", () => {
  let userId: string;
  const ids: Record<string, string> = {};

  const cleanup = async (): Promise<void> => {
    await prisma.placeVisit.deleteMany({ where: { user: { username: USER } } });
    await prisma.place.deleteMany({ where: { user: { username: USER } } });
    await prisma.user.deleteMany({ where: { username: USER } });
  };

  const place = async (
    key: string,
    opts: {
      at?: Date;
      createdAt?: Date;
      updatedAt?: Date;
      curatedItemId?: string;
    }
  ): Promise<void> => {
    const p = await prisma.place.create({
      data: {
        userId,
        name: key,
        lat: 48.1,
        lon: 11.5,
        category: "landmark",
        visited: false,
        curatedItemId: opts.curatedItemId,
        updatedAt: opts.updatedAt,
      },
    });
    ids[key] = p.id;
    if (opts.at) {
      await prisma.placeVisit.create({
        data: {
          placeId: p.id,
          userId,
          visitedAt: opts.at,
          visitedAtUtc: opts.at,
          visitedZone: "UTC",
          createdAt: opts.createdAt ?? PLANNED_AT,
        },
      });
    }
  };

  const visited = async (key: string): Promise<boolean> =>
    (await prisma.place.findUniqueOrThrow({ where: { id: ids[key] } })).visited;

  beforeAll(async () => {
    await cleanup();
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
    // Plan made two months ago for three days ago; place untouched since.
    await place("elapsedPlan", { at: PAST, updatedAt: PLANNED_AT });
    // The user unmarked the place AFTER the plan came due.
    await place("unmarked", { at: PAST, updatedAt: new Date(NOW.getTime() - DAY) });
    // Curated checklist row, unticked: visits stay, state belongs to the list.
    await place("curated", { at: PAST, updatedAt: PLANNED_AT, curatedItemId: "whc-test-9" });
    // Plan still in the future.
    await place("stillPlanned", { at: new Date(NOW.getTime() + DAY), updatedAt: PLANNED_AT });
    // Visit entered after the fact on an unvisited place.
    await place("afterTheFact", { at: PAST, createdAt: PAST, updatedAt: PLANNED_AT });
    await place("wishlist", {});
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("the predicate reads an elapsed plan as visited without any write", async () => {
    const row = await prisma.place.findUniqueOrThrow({
      where: { id: ids.elapsedPlan },
      include: { visits: true },
    });
    expect(row.visited).toBe(false);
    expect(isEffectivelyVisited(row, row.visits, NOW)).toBe(true);
    expect(hasElapsedPlan(row, row.visits, new Date(PAST.getTime() - DAY))).toBe(false);
  });

  it("the place endpoints answer visited for an elapsed plan before the sweep ran", async () => {
    const row = await prisma.place.findUniqueOrThrow({
      where: { id: ids.elapsedPlan },
      include: { visits: true },
    });
    expect(decorate(row, NOW).visited).toBe(true);
    const unmarked = await prisma.place.findUniqueOrThrow({
      where: { id: ids.unmarked },
      include: { visits: true },
    });
    expect(decorate(unmarked, NOW).visited).toBe(false);
  });

  it("the sweep persists the flag for the elapsed plan only", async () => {
    const first = await sweepElapsedPlannedVisits(NOW);
    expect(first.promoted).toBeGreaterThanOrEqual(1);
    expect(await visited("elapsedPlan")).toBe(true);
    expect(await visited("unmarked")).toBe(false);
    expect(await visited("curated")).toBe(false);
    expect(await visited("stillPlanned")).toBe(false);
    expect(await visited("afterTheFact")).toBe(false);
    expect(await visited("wishlist")).toBe(false);
  });

  it("is idempotent, and an explicit unmark after the promotion stays unmarked", async () => {
    const again = await sweepElapsedPlannedVisits(NOW);
    expect(again.promoted).toBe(0);
    await prisma.place.update({ where: { id: ids.elapsedPlan }, data: { visited: false } });
    await sweepElapsedPlannedVisits(new Date(NOW.getTime() + DAY));
    expect(await visited("elapsedPlan")).toBe(false);
  });
});
