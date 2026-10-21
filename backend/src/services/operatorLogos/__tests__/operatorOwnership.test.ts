import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { isKnownOperatorName } from "../operatorOwnership";

/**
 * Review of forgejo#323: the mark endpoints took any string and looked it up
 * on Wikimedia. Only a catalogued name or one the user's OWN journeys record
 * may be — another user's operator is not this user's reason to ask.
 */
const OWNER = "operator-ownership-owner";
const OTHER = "operator-ownership-other";

describe("isKnownOperatorName", () => {
  let ownerId: string;
  let otherId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: [OWNER, OTHER] } } });
    const passwordHash = await hashPassword("password123");
    ownerId = (await prisma.user.create({ data: { username: OWNER, passwordHash } })).id;
    otherId = (await prisma.user.create({ data: { username: OTHER, passwordHash } })).id;
    await prisma.busJourney.create({
      data: {
        userId: ownerId,
        operator: "FlixBus",
        depStationName: "Lisboa Sete Rios",
        depLat: 38.73,
        depLon: -9.17,
        arrStationName: "Porto Campanhã",
        arrLat: 41.15,
        arrLon: -8.59,
        departureTime: new Date("2026-05-08T09:15:00Z"),
        status: "completed",
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: [OWNER, OTHER] } } });
    await prisma.$disconnect();
  });

  it("knows an operator the user's own journeys record, in any case", async () => {
    expect(await isKnownOperatorName(ownerId, "bus", "flixbus")).toBe(true);
  });

  it("does not know it for another user, nor for another domain", async () => {
    expect(await isKnownOperatorName(otherId, "bus", "FlixBus")).toBe(false);
    expect(await isKnownOperatorName(ownerId, "ferry", "FlixBus")).toBe(false);
  });

  it("knows the catalogued rail operators and rental companies for anyone", async () => {
    expect(await isKnownOperatorName(otherId, "rail", "SBB")).toBe(true);
    expect(await isKnownOperatorName(otherId, "rental", "Sixt")).toBe(true);
  });

  it("never knows an arbitrary string", async () => {
    expect(await isKnownOperatorName(ownerId, "cruise", "x".repeat(100))).toBe(false);
  });
});
