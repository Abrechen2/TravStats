import { prisma } from "../../../../db";
import { hashPassword } from "../../../../utils/password";
import { railAdapter } from "../flat";

/**
 * rc.45 integration: an operator the server inferred from the train
 * (`operatorSource = "inferred"`) is not a fact the owner stated. Sharing it
 * would hand a guess to the member as if it were the owner's word, and a copy
 * carried no `operatorSource` to say otherwise.
 */
describe("rail sharing: an inferred operator is not shared", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        username: `rail-inferred-share-${Date.now()}`,
        passwordHash: await hashPassword("test-password"),
        isActive: true,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.railJourney.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const journey = (operator: string | null, operatorSource: string | null) =>
    prisma.railJourney.create({
      data: {
        userId,
        operator,
        operatorSource,
        trainCategory: "ICE",
        trainNumber: "599",
        depStationName: "Berlin Hbf",
        depLat: 52.525,
        depLon: 13.369,
        depTimezone: "Europe/Berlin",
        arrStationName: "München Hbf",
        arrLat: 48.14,
        arrLon: 11.558,
        arrTimezone: "Europe/Berlin",
        departureTime: new Date("2025-05-06T09:00:00.000Z"),
        arrivalTime: new Date("2025-05-06T13:00:00.000Z"),
        status: "completed",
      },
    });

  it("reads an inferred operator as null in the shared facts", async () => {
    const row = await journey("DB Fernverkehr", "inferred");
    const [shared] = await railAdapter.load(prisma, [row.id]);
    expect(shared.facts.operator).toBeNull();
  });

  it("shares an operator the owner entered", async () => {
    const row = await journey("DB Fernverkehr", null);
    const [shared] = await railAdapter.load(prisma, [row.id]);
    expect(shared.facts.operator).toBe("DB Fernverkehr");
  });

  it("a shared operator replaces the copy's own guess and its inferred mark", async () => {
    const copy = await journey("Guessed Rail", "inferred");
    const [row] = await railAdapter.load(prisma, [copy.id]);
    await railAdapter.apply(prisma, row, { operator: "DB Fernverkehr" }, ["operator"]);
    const after = await prisma.railJourney.findUniqueOrThrow({ where: { id: copy.id } });
    expect(after.operator).toBe("DB Fernverkehr");
    expect(after.operatorSource).toBeNull();
  });
});
