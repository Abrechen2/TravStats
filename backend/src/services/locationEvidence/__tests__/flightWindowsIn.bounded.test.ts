import { prisma } from "../../../db";
import { flightWindowsIn } from "../derivationRead";
import { makeFlight, makeUser } from "../../travtrack/__tests__/fixtures";

/** forgejo#335: the flight read is windowed in the database, the answer is unchanged. */
describe("flightWindowsIn — bounded", () => {
  let userId: string;
  const DEP = Date.parse("2026-10-12T00:30:00Z");

  beforeAll(async () => {
    userId = await makeUser("flightwindowsin-bounded-a");
  });
  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("reads only flights near the window yet still returns the flight inside it", async () => {
    const near = await makeFlight(userId);
    for (let i = 0; i < 4; i++) {
      await prisma.flight.create({
        data: {
          userId,
          depIata: "ICN",
          arrIata: "CJU",
          depLat: 37.469,
          depLon: 126.451,
          arrLat: 33.511,
          arrLon: 126.493,
          flightNumber: `KE9${i}`,
          departureTime: new Date(Date.parse("2019-03-01T10:00:00Z") + i * 86_400_000),
          arrivalTime: new Date(Date.parse("2019-03-01T11:00:00Z") + i * 86_400_000),
          status: "flown",
        },
      });
    }
    const original = prisma.flight.findMany.bind(prisma.flight);
    let read = 0;
    const spy = jest.spyOn(prisma.flight, "findMany").mockImplementation(((
      args: Parameters<typeof original>[0]
    ) =>
      original(args).then((rows) => {
        read += rows.length;
        return rows;
      })) as unknown as typeof prisma.flight.findMany);
    try {
      const windows = await flightWindowsIn(userId, {
        fromMs: DEP - 3_600_000,
        untilMs: DEP + 7_200_000,
      });
      expect(near).toBeTruthy();
      expect(windows).toHaveLength(1);
      expect(windows[0][0]).toBeLessThanOrEqual(DEP);
      expect(read).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});
