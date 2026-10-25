import { prisma } from "../../../db";
import { utcMidnight } from "../../countryDays/store";
import { setLocationProvider } from "../../locationProvider/provider";
import { makeUser } from "../../travtrack/__tests__/fixtures";
import { travTrackSwitches } from "../../travtrack/__tests__/switches";
import { acceptCountrySuggestion } from "../countryAccept";
import { countrySuggestions } from "../countrySuggestions";

/**
 * The accept protocol claims the question and works on the row it claimed
 * (Codex review of E6): a run that grew while the answer was on its way is
 * answered as it stands at the claim, never as an older snapshot.
 */

const PREFIX = "evidence-accept-flow-";

describe("acceptFlow", () => {
  const switches = travTrackSwitches();
  let userId: string;

  const day = (date: string) =>
    prisma.countryDay.create({
      data: {
        userId,
        source: "travtrack",
        date: utcMidnight(date),
        countryCode: "PT",
        pointCount: 10,
        airportPointCount: 0,
        spanKm: 1,
      },
    });

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY ??= "c".repeat(64);
    userId = await makeUser(`${PREFIX}a`);
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await prisma.countryDay.deleteMany({ where: { userId } });
    await prisma.locationSuggestion.deleteMany({ where: { userId } });
    await prisma.countryOverride.deleteMany({ where: { userId } });
    await setLocationProvider(userId, "travtrack");
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("a run that grows backwards between load and claim is answered on its new first day", async () => {
    await day("2026-10-12");
    await day("2026-10-13");
    await countrySuggestions(userId);
    const { id } = await prisma.locationSuggestion.findFirstOrThrow({ where: { userId } });

    const accepted = await acceptCountrySuggestion(userId, id, "visited", {
      afterLoad: async () => {
        await day("2026-10-11");
        await countrySuggestions(userId);
      },
    });

    expect(accepted.windowFrom).toEqual(utcMidnight("2026-10-11"));
    const override = await prisma.countryOverride.findFirstOrThrow({ where: { userId } });
    expect(override.day).toEqual(utcMidnight("2026-10-11"));
  });
});
