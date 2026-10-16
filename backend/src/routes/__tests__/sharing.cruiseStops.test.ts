import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import {
  makeAccount,
  sharedPair,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * A cruise's port calls reach the other member's copy by DAY and port, never
 * by list position: a member's own excursion note and all-aboard time belong
 * to one call and must not slide onto another day's, and a call carrying them
 * is not deleted behind the member's back.
 */
describe("sharing — cruise port calls keep their private fields", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let pair: Awaited<ReturnType<typeof sharedPair>>;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna");
    ben = await makeAccount("ben");
    pair = await sharedPair(anna, ben);
    const copy = await bensCruise();
    // Ben's own notes on his copy of the Funchal call (day 2).
    await prisma.cruiseStop.update({
      where: { id: copy.stops[1].id },
      data: { excursionNote: "Bens Levada-Wanderung", allAboardTime: "17:30" },
    });
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  const bensCruise = () =>
    prisma.cruise.findFirstOrThrow({
      where: { userId: ben.id },
      include: { stops: { orderBy: [{ dayNumber: "asc" }, { id: "asc" }] } },
    });

  const patchStops = (stops: object[]) =>
    request(app)
      .patch(`/api/v1/cruises/${pair.full.cruise.id}`)
      .set("Cookie", anna.cookie)
      .send({ stops })
      .expect(200);

  it("an inserted sea day moves Funchal to day 3 and Ben's note goes with it", async () => {
    await patchStops([
      { dayNumber: 1, isAtSea: true },
      { dayNumber: 2, isAtSea: true },
      { dayNumber: 3, isAtSea: false, unresolvedPortName: "Funchal" },
    ]);
    const after = await bensCruise();
    expect(
      after.stops.map((s) => [s.dayNumber, s.isAtSea, s.unresolvedPortName, s.excursionNote])
    ).toEqual([
      [1, true, null, null],
      [2, true, null, null],
      [3, false, "Funchal", "Bens Levada-Wanderung"],
    ]);
    expect(after.stops[2].allAboardTime).toBe("17:30");
  });

  it("a port that replaces Funchal on another day does not take Ben's note", async () => {
    await patchStops([
      { dayNumber: 1, isAtSea: true },
      { dayNumber: 2, isAtSea: true },
      { dayNumber: 3, isAtSea: false, unresolvedPortName: "Santa Cruz de Tenerife" },
    ]);
    const after = await bensCruise();
    const tenerife = after.stops.find((s) => s.unresolvedPortName === "Santa Cruz de Tenerife");
    expect(tenerife?.excursionNote).toBeNull();
    expect(tenerife?.allAboardTime).toBeNull();
    // Ben's Funchal call carries his own words, so it is kept, not deleted.
    const funchal = after.stops.find((s) => s.unresolvedPortName === "Funchal");
    expect(funchal?.excursionNote).toBe("Bens Levada-Wanderung");
    expect(after.stops.filter((s) => s.isAtSea).map((s) => s.dayNumber)).toEqual([1, 2]);
  });

  it("a dropped call without private fields goes, one with them stays", async () => {
    await patchStops([{ dayNumber: 1, isAtSea: true }]);
    const after = await bensCruise();
    expect(after.stops.map((s) => [s.dayNumber, s.unresolvedPortName])).toEqual([
      [1, null],
      [2, "Funchal"],
    ]);
  });
});
