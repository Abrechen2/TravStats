import { prisma } from "../../../db";
import { loadPassport } from "../passportLoader";
import { loadCountryDetail } from "../countryDetailLoader";
import { loadDaysAway } from "../daysAwayLoader";
import { loadTravelAccountData } from "../travelAccountData";
import { buildTravelAccount } from "../travelAccount";
import { resolveTravelAccountHotelNights } from "../../evidence/metricEvidenceTravelAccount";
import { assertSumInvariant } from "../../evidence/__tests__/invariants";

/**
 * Audit, 2.7: the Stats overview counted a roadtrip's countries, and three
 * other figures read on the same page did not know the roadtrip existed —
 * the passport, the nights account (a night at a free pitch was billed as a
 * night at home) and "days away". These run the real loaders against one
 * account so the wiring, not only the arithmetic, is pinned.
 */

const USER = "roadtripstatsloaders";
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("roadtrips in the passport, the nights account and days away", () => {
  let userId: string;
  let roadtripId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;

    const route = await prisma.tripRoute.create({
      data: { userId, name: "Norwegen", mode: "road", kind: "roadtrip" },
    });
    roadtripId = route.id;
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Hotel Lillehammer", type: "hotel", isoCountryCode: "NO" },
    });
    const stay = await prisma.lodgingStay.create({
      data: { userId, lodgingId: lodging.id, checkIn: d("2024-07-15"), checkOut: d("2024-07-16") },
    });
    const stations: Array<{
      title: string;
      lat: number;
      lon: number;
      start: string;
      end: string | null;
      overnight: boolean;
      lodgingStayId?: string;
    }> = [
      // Hamburg, driven through — inland, the boundaries answer DE.
      { title: "Hamburg", lat: 53.55, lon: 9.99, start: "2024-07-12", end: null, overnight: false },
      // A free pitch near Dombås for two nights — inland Norway.
      {
        title: "Dombås Rasteplass",
        lat: 62.07,
        lon: 9.12,
        start: "2024-07-13",
        end: "2024-07-15",
        overnight: true,
      },
      // One hotel night — already counted as a stay, never a second time.
      {
        title: "Lillehammer",
        lat: 61.11,
        lon: 10.46,
        start: "2024-07-15",
        end: "2024-07-16",
        overnight: true,
        lodgingStayId: stay.id,
      },
    ];
    for (const [i, s] of stations.entries()) {
      await prisma.tripStop.create({
        data: {
          title: s.title,
          lat: s.lat,
          lon: s.lon,
          startDate: d(s.start),
          endDate: s.end ? d(s.end) : null,
          routeId: route.id,
          routeOrderIdx: i,
          overnight: s.overnight,
          lodgingStayId: s.lodgingStayId ?? null,
        },
      });
    }

    // A roadtrip still ahead: counts nowhere.
    const planned = await prisma.tripRoute.create({
      data: { userId, name: "Österreich", mode: "road", kind: "roadtrip" },
    });
    await prisma.tripStop.create({
      data: {
        title: "Salzburg",
        lat: 47.8,
        lon: 13.04,
        startDate: d("2099-06-01"),
        endDate: d("2099-06-03"),
        routeId: planned.id,
        routeOrderIdx: 0,
        overnight: true,
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    await prisma.$disconnect();
  });

  it("the passport carries the countries a started roadtrip's stations stand in, by tier", async () => {
    const passport = await loadPassport(userId);
    const byCode = new Map(passport.countries.map((c) => [c.code, c]));
    expect(byCode.get("DE")).toMatchObject({ tier: "transited", kinds: ["roadtrip"] });
    expect(byCode.get("NO")).toMatchObject({ tier: "slept" });
    expect(byCode.get("NO")?.kinds).toEqual(["lodging", "roadtrip"]);
    expect(byCode.has("AT")).toBe(false);
  });

  it("the country drill-down names each station and links its roadtrip", async () => {
    const detail = await loadCountryDetail(userId, "DE");
    expect(detail?.timeline).toEqual([
      {
        kind: "roadtrip",
        date: "2024-07-12",
        roadtripId,
        roadtripName: "Norwegen",
        stationId: expect.any(String),
        stationTitle: "Hamburg",
      },
    ]);
    expect(await loadCountryDetail(userId, "AT")).toBeNull();
  });

  it("the nights account bills the free-pitch nights as nights away, and the hotel night once", async () => {
    const account = buildTravelAccount(await loadTravelAccountData(userId));
    const y2024 = account.years.find((y) => y.year === "2024");
    // Two free nights (13th, 14th) plus the one stay night (15th).
    expect(y2024?.hotelNights).toBe(3);

    // The panel behind the tile names the free-pitch station, linked to its
    // roadtrip, and its entries still add up to the tile.
    const res = await resolveTravelAccountHotelNights(
      userId,
      { period: { kind: "allTime" } },
      { offset: 0, limit: 50 }
    );
    expect(res.measure.value).toBe(3);
    assertSumInvariant(res, Math.round);
    expect(res.entries.find((e) => e.domain === "roadtrip")).toMatchObject({
      href: `/roadtrips/${roadtripId}`,
      title: { text: "Norwegen" },
      subtitle: { text: "Dombås Rasteplass" },
      contribution: 2,
    });
  });

  it("days away counts every station's days, the planned roadtrip none", async () => {
    const days = await loadDaysAway(userId);
    // 12th (pass), 13th–15th (free), 15th–16th (stay) → 12..16 = five days.
    expect(days.roadtrip).toBe(5);
    expect(days.total).toBe(5);
    expect((await loadDaysAway(userId, { year: 2099 })).total).toBe(0);
  });
});
