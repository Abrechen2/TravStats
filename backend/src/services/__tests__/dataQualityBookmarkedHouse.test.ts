/**
 * The inbox must ask the same question as the passport, or it outlives its own
 * subject.
 *
 * Found on the owner's real data, 2026-09-02. A Bucharest hotel he had never
 * stayed in was un-marked as visited. The country left the passport at once —
 * `passportLoader` selects `where: { visited: true }`. The flag saying "Romania
 * rests only on undated evidence" stayed **open**, because `gather.ts` selected
 * on `userId` alone and still saw the house. A question about a country that no
 * longer exists is worse than no question: it is the inbox telling the user to
 * go and fix something that is already fixed.
 *
 * The mirror of it is worse still and is pinned here too: a bookmarked house
 * could raise a flag about a country nothing in the app counts.
 *
 * The asymmetry in the third test is deliberate, not an oversight. `visited`
 * governs whether a house proves a COUNTRY. It does not govern whether the
 * house's own record is self-consistent — a wrong address is a wrong address
 * whether or not anybody slept there.
 */
import { prisma } from "../../db";
import { runDataQualityChecks } from "../dataQuality";

const countryFlags = (userId: string) =>
  prisma.dataQualityFlag.findMany({
    where: { userId, kind: "undated_country_evidence" },
    select: { entityId: true, status: true },
  });

describe("a bookmarked house and the inbox", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `dq-bookmark-${Date.now()}`, passwordHash: "x" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("raises no country flag for a house the user only bookmarked", async () => {
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Nur gemerkt", isoCountryCode: "MT", visited: false },
    });

    await runDataQualityChecks(userId);

    expect(await countryFlags(userId)).toEqual([]);
    await prisma.lodging.delete({ where: { id: lodging.id } });
  });

  it("resolves the flag when the house that raised it stops being a visit", async () => {
    // The owner's exact move: the country was counted, the inbox asked about it,
    // and then the house was un-marked. The question must go with the subject.
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Hotel Bukarest", isoCountryCode: "RO", visited: true },
    });

    await runDataQualityChecks(userId);
    expect(await countryFlags(userId)).toEqual([{ entityId: "RO", status: "open" }]);

    await prisma.lodging.update({ where: { id: lodging.id }, data: { visited: false } });
    const second = await runDataQualityChecks(userId);

    expect(second.autoResolved).toBe(1);
    expect(await countryFlags(userId)).toEqual([{ entityId: "RO", status: "resolved" }]);

    await prisma.dataQualityFlag.deleteMany({ where: { userId } });
    await prisma.lodging.delete({ where: { id: lodging.id } });
  });

  it("still checks a bookmarked house's own address against its own country", async () => {
    const lodging = await prisma.lodging.create({
      data: {
        userId,
        name: "Hotel Sport",
        address: "Grajska cesta 2, Otočec, Slovenia",
        country: "Romania",
        isoCountryCode: "RO",
        visited: false,
      },
    });

    await runDataQualityChecks(userId);

    const flags = await prisma.dataQualityFlag.findMany({
      where: { userId },
      select: { kind: true },
    });
    expect(flags.map((f) => f.kind)).toEqual(["address_country_mismatch"]);

    await prisma.dataQualityFlag.deleteMany({ where: { userId } });
    await prisma.lodging.delete({ where: { id: lodging.id } });
  });
});
