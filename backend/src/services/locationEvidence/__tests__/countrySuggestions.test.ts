import { prisma } from "../../../db";
import { utcMidnight } from "../../countryDays/store";
import { setLocationProvider } from "../../locationProvider/provider";
import { makeUser } from "../../travtrack/__tests__/fixtures";
import { travTrackSwitches } from "../../travtrack/__tests__/switches";
import { countrySuggestions, MAX_NEW_COUNTRY_QUESTIONS } from "../countrySuggestions";
import { bumpHistoryGeneration } from "../generation";

/**
 * Country questions from TravTrack (TravTrack plan E6; review focus 19, 20):
 * a country the passport lacks, seen on at least two ground days in a row,
 * becomes one question per run of days — bounded, never asked again once
 * answered no, and never for an account whose provider is not TravTrack.
 */

const PREFIX = "evidence-country-suggestions-";

describe("countrySuggestions", () => {
  const switches = travTrackSwitches();
  let userId: string;

  const day = (
    date: string,
    countryCode: string,
    pointCount = 10,
    airportPointCount = 0,
    source = "travtrack"
  ) =>
    prisma.countryDay.create({
      data: {
        userId,
        source,
        date: utcMidnight(date),
        countryCode,
        pointCount,
        airportPointCount,
        spanKm: 1,
      },
    });
  const questions = () =>
    prisma.locationSuggestion.findMany({
      where: { userId, kind: "country" },
      orderBy: { windowFrom: "asc" },
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
    await prisma.place.deleteMany({ where: { userId } });
    await prisma.travTrackDerivationState.deleteMany({ where: { userId } });
    await setLocationProvider(userId, "travtrack");
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("two ground days in a country the passport lacks → one question", async () => {
    await day("2026-10-12", "PT", 40);
    await day("2026-10-13", "PT", 60);

    const result = await countrySuggestions(userId);

    expect(result).toMatchObject({ status: "done", created: 1 });
    const [q] = await questions();
    expect(q).toMatchObject({
      kind: "country",
      provider: "travtrack",
      status: "pending",
      windowFrom: utcMidnight("2026-10-12"),
      windowUntil: utcMidnight("2026-10-14"),
      explanation: { code: "country.groundDays", params: { country: "PT", days: 2, points: 100 } },
    });
    expect(q.evidence).toMatchObject({ countryCode: "PT", days: 2, pointCount: 100 });
    // The key is a digest: no country, no day in it.
    expect(q.evidenceKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it("one ground day, or days spent airside only, ask nothing", async () => {
    await day("2026-10-12", "PT");
    await day("2026-10-20", "QA", 10, 10);
    await day("2026-10-21", "QA", 4, 4);

    expect((await countrySuggestions(userId)).created).toBe(0);
    expect(await questions()).toEqual([]);
  });

  it("a gap splits a country's days into separate runs", async () => {
    await day("2026-03-01", "PT");
    await day("2026-03-02", "PT");
    await day("2026-06-10", "PT");
    await day("2026-06-11", "PT");

    await countrySuggestions(userId);

    expect((await questions()).map((q) => q.windowFrom.toISOString().slice(0, 10))).toEqual([
      "2026-03-01",
      "2026-06-10",
    ]);
  });

  it("a country the passport holds already asks nothing", async () => {
    await prisma.place.create({
      data: { userId, name: "Belém", lat: 38.69, lon: -9.21, isoCountryCode: "PT", visited: true },
    });
    await day("2026-10-12", "PT");
    await day("2026-10-13", "PT");

    expect((await countrySuggestions(userId)).created).toBe(0);
  });

  it("a country the user gave a verdict on asks nothing", async () => {
    await prisma.countryOverride.create({
      data: { userId, countryCode: "PT", verdict: "excluded", note: "" },
    });
    await day("2026-10-12", "PT");
    await day("2026-10-13", "PT");

    expect((await countrySuggestions(userId)).created).toBe(0);
  });

  it("a third day grows the pending question", async () => {
    await day("2026-10-12", "PT");
    await day("2026-10-13", "PT");
    await countrySuggestions(userId);
    const [before] = await questions();

    await day("2026-10-14", "PT");
    const result = await countrySuggestions(userId);

    expect(result).toMatchObject({ created: 0, grown: 1 });
    const all = await questions();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      id: before.id,
      status: "pending",
      windowUntil: utcMidnight("2026-10-15"),
      explanation: { params: { days: 3 } },
    });
  });

  it("a day before the run grows it too, and does not ask twice", async () => {
    await day("2026-10-12", "PT");
    await day("2026-10-13", "PT");
    await countrySuggestions(userId);

    await day("2026-10-11", "PT");
    await countrySuggestions(userId);

    const all = await questions();
    expect(all).toHaveLength(1);
    expect(all[0].windowFrom).toEqual(utcMidnight("2026-10-11"));
  });

  it("a rejected run is not asked again", async () => {
    await day("2026-10-12", "PT");
    await day("2026-10-13", "PT");
    await countrySuggestions(userId);
    await prisma.locationSuggestion.updateMany({
      where: { userId },
      data: { status: "rejected", resolvedAt: new Date() },
    });

    await day("2026-10-14", "PT");
    const result = await countrySuggestions(userId);

    expect(result.created).toBe(0);
    const all = await questions();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("rejected");
    expect(all[0].windowUntil).toEqual(utcMidnight("2026-10-14"));
  });

  it("no more than three new per run; the rest wait for the next", async () => {
    for (const code of ["PT", "ES", "FR", "IT", "AT"]) {
      await day("2026-10-12", code);
      await day("2026-10-13", code);
    }

    const first = await countrySuggestions(userId);
    expect(first).toMatchObject({ created: MAX_NEW_COUNTRY_QUESTIONS, deferred: 2 });
    expect(MAX_NEW_COUNTRY_QUESTIONS).toBe(3);

    expect((await countrySuggestions(userId)).created).toBe(2);
    expect(await questions()).toHaveLength(5);
  });

  it("provider dawarich, or none, asks nothing", async () => {
    await day("2026-10-12", "PT");
    await day("2026-10-13", "PT");
    // Dawarich rows of the same days do not make TravTrack questions either.
    await day("2026-10-12", "ES", 10, 0, "dawarich");
    await day("2026-10-13", "ES", 10, 0, "dawarich");

    await prisma.userSettings.update({
      where: { userId },
      data: { locationProvider: "dawarich" },
    });
    expect(await countrySuggestions(userId)).toMatchObject({ status: "skipped", created: 0 });

    await setLocationProvider(userId, "none");
    expect(await countrySuggestions(userId)).toMatchObject({ status: "skipped", created: 0 });
    expect(await questions()).toEqual([]);

    // Back on TravTrack: only TravTrack's own rows ask.
    await setLocationProvider(userId, "travtrack");
    await countrySuggestions(userId);
    expect(
      (await questions()).map((q) => (q.evidence as { countryCode: string }).countryCode)
    ).toEqual(["PT"]);
  });

  it("TravTrack off asks nothing", async () => {
    await day("2026-10-12", "PT");
    await day("2026-10-13", "PT");
    await switches.set({ beta: true, config: false });

    expect(await countrySuggestions(userId)).toMatchObject({ status: "skipped", created: 0 });
  });

  it("history removed between the read and the publication publishes nothing", async () => {
    await day("2026-10-12", "PT");
    await day("2026-10-13", "PT");

    const result = await countrySuggestions(userId, {
      afterRead: () =>
        prisma.$transaction((tx) => bumpHistoryGeneration(tx, userId)).then(() => {}),
    });

    expect(result).toMatchObject({ status: "stale", created: 0 });
    expect(await questions()).toEqual([]);
  });
});
