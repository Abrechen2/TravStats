import { prisma } from "../../../db";
import { makeUser } from "../../travtrack/__tests__/fixtures";
import { getPlanSnapshot } from "../actual/planSnapshot";
import { hash } from "../store";
import { makePlanTrip } from "./planActualFixtures";

/** The plan as it stands, read and never written (TravTrack plan L5, review focus 29). */

const PREFIX = "plan-snapshot-";

describe("getPlanSnapshot", () => {
  let owner: string;
  let stranger: string;

  beforeAll(async () => {
    owner = await makeUser(`${PREFIX}owner`);
    stranger = await makeUser(`${PREFIX}stranger`);
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("reads the active route with the plan's own schedule", async () => {
    const { tripId, state } = await makePlanTrip(owner);
    const snapshot = await getPlanSnapshot(owner, tripId);
    expect(snapshot).toMatchObject({
      revision: 4,
      startDay: "2026-10-01",
      endDay: "2026-10-06",
      timezone: "Europe/Vienna",
    });
    expect(snapshot!.stations.map((s) => s.id)).toEqual(state.stations.map((s) => s.id));
    expect(snapshot!.schedule.stations).toEqual([
      { stationId: state.stations[0].id, arriveDay: "2026-10-01", departDay: "2026-10-03" },
      { stationId: state.stations[1].id, arriveDay: "2026-10-03", departDay: "2026-10-04" },
      { stationId: state.stations[2].id, arriveDay: "2026-10-04", departDay: "2026-10-06" },
    ]);
  });

  it("is deep-frozen", async () => {
    const { tripId } = await makePlanTrip(owner);
    const snapshot = await getPlanSnapshot(owner, tripId);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot!.stations[0].place)).toBe(true);
    expect(() => {
      (snapshot!.stations[0].place as { lat: number }).lat = 0;
    }).toThrow(TypeError);
  });

  it("writes nothing: revision, state, mutations and proposals unchanged", async () => {
    const { tripId } = await makePlanTrip(owner);
    const before = await prisma.travelPlan.findUniqueOrThrow({ where: { tripId } });
    await getPlanSnapshot(owner, tripId);
    const after = await prisma.travelPlan.findUniqueOrThrow({ where: { tripId } });
    expect(after.revision).toBe(before.revision);
    expect(hash(after.state)).toBe(hash(before.state));
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(await prisma.travelPlanMutation.count({ where: { planId: before.id } })).toBe(0);
    expect(await prisma.travelPlanProposal.count({ where: { planId: before.id } })).toBe(0);
  });

  it("another user's plan reads as none", async () => {
    const { tripId } = await makePlanTrip(owner);
    expect(await getPlanSnapshot(stranger, tripId)).toBeNull();
  });
});
