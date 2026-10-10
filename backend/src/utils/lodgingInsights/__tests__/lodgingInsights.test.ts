import { computeLodgingInsights, type InsightStay } from "..";
import { totalsOf } from "../../../services/stats/insights/measureItems";

const NOW = new Date("2026-10-09T12:00:00Z");
const d = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

let seq = 0;
function stay(
  over: Partial<InsightStay> & { checkIn?: string | null; checkOut?: string | null }
): InsightStay {
  seq += 1;
  const { checkIn, checkOut, ...rest } = over;
  return {
    id: `s${seq}`,
    lodgingId: "h1",
    lodgingName: "Haus Eins",
    type: "hotel",
    checkIn: checkIn === undefined ? d("2024-03-01") : checkIn === null ? null : d(checkIn),
    checkOut: checkOut === undefined ? d("2024-03-03") : checkOut === null ? null : d(checkOut),
    datePrecision: "DAY",
    nights: null,
    status: "completed",
    roomCategory: null,
    board: null,
    currency: "EUR",
    totalPrice: null,
    isAwardStay: false,
    trip: null,
    ...rest,
  };
}

const trip = (id: string, over: Partial<InsightStay["trip"] & object> = {}) => ({
  id,
  name: `Reise ${id}`,
  category: null,
  endDate: d("2024-12-31"),
  ...over,
});

describe("lodging insights — sleeping style (forgejo#258 item 1)", () => {
  it("files nights by house type in the year each night starts, and leaves a stay ahead out", () => {
    const { insights } = computeLodgingInsights(
      [
        stay({ type: "hotel", checkIn: "2024-12-30", checkOut: "2025-01-02" }),
        stay({ type: "campsite", lodgingId: "c1", checkIn: "2025-06-01", checkOut: "2025-06-03" }),
        stay({ type: "apartment", lodgingId: "a1", checkIn: "2026-12-01", checkOut: "2026-12-05" }),
      ],
      NOW
    );
    expect(insights.sleepStyle.byYear).toEqual([
      { year: 2024, nightsByType: { hotel: 2 }, nights: 2 },
      { year: 2025, nightsByType: { hotel: 1, campsite: 2 }, nights: 3 },
    ]);
  });

  it("counts a stay with no known length instead of reading it as zero nights", () => {
    const { insights } = computeLodgingInsights(
      [
        stay({
          datePrecision: "MONTH",
          checkIn: "2019-07-01",
          checkOut: "2019-07-31",
          nights: null,
        }),
        stay({ datePrecision: "MONTH", checkIn: "2019-08-01", checkOut: "2019-08-31", nights: 3 }),
        stay({ datePrecision: "NONE", checkIn: null, checkOut: null, nights: 2 }),
      ],
      NOW
    );
    expect(insights.sleepStyle.unknownLengthStays).toBe(1);
    expect(insights.sleepStyle.byYear).toEqual([
      { year: 2019, nightsByType: { hotel: 3 }, nights: 3 },
    ]);
    expect(insights.sleepStyle.unplacedNights).toBe(2);
  });
});

describe("lodging insights — coming back (item 2)", () => {
  it("finds the years at one house and the longest gap between two dated stays", () => {
    const { insights } = computeLodgingInsights(
      [
        stay({ checkIn: "2019-05-01", checkOut: "2019-05-03" }),
        stay({ checkIn: "2021-05-01", checkOut: "2021-05-02" }),
        stay({ datePrecision: "YEAR", checkIn: "2023-01-01", checkOut: "2023-12-31", nights: 2 }),
        stay({ checkIn: "2024-05-10", checkOut: "2024-05-12" }),
        stay({
          lodgingId: "h2",
          lodgingName: "Einmal",
          checkIn: "2020-01-01",
          checkOut: "2020-01-02",
        }),
      ],
      NOW
    );
    expect(insights.revisits.houses).toEqual([
      { lodgingId: "h1", name: "Haus Eins", years: [2019, 2021, 2023, 2024], stays: 4 },
    ]);
    expect(insights.revisits.sameHouseYearsMax).toBe(4);
    // 2021-05-02 → 2024-05-10: the YEAR-precision stay between them is no date.
    expect(insights.revisits.longestGap).toMatchObject({
      lodgingId: "h1",
      from: "2021-05-02",
      to: "2024-05-10",
      days: 1104,
    });
  });

  it("measures a break from the latest check-out, not from a short booking inside a long one", () => {
    const { insights } = computeLodgingInsights(
      [
        stay({ checkIn: "2024-03-01", checkOut: "2024-03-10" }),
        stay({ checkIn: "2024-03-02", checkOut: "2024-03-03" }),
        stay({ checkIn: "2024-03-20", checkOut: "2024-03-21" }),
      ],
      NOW
    );
    expect(insights.revisits.longestGap).toMatchObject({ days: 10, from: "2024-03-10" });
  });

  it("does not read touching stays at one house as a gap", () => {
    const { insights } = computeLodgingInsights(
      [
        stay({ checkIn: "2024-03-01", checkOut: "2024-03-03" }),
        stay({ checkIn: "2024-03-03", checkOut: "2024-03-05" }),
      ],
      NOW
    );
    expect(insights.revisits.longestGap).toBeNull();
  });
});

describe("lodging insights — bases on a trip (item 3)", () => {
  it("counts moves in check-in order and merges touching stays at one house", () => {
    const t = trip("t1");
    const { insights } = computeLodgingInsights(
      [
        stay({ trip: t, lodgingId: "A", checkIn: "2024-07-01", checkOut: "2024-07-03" }),
        stay({ trip: t, lodgingId: "A", checkIn: "2024-07-03", checkOut: "2024-07-05" }),
        stay({
          trip: t,
          lodgingId: "B",
          type: "campsite",
          checkIn: "2024-07-05",
          checkOut: "2024-07-06",
        }),
        stay({ trip: t, lodgingId: "A", checkIn: "2024-07-06", checkOut: "2024-07-07" }),
      ],
      NOW
    );
    expect(insights.tripBases.trips).toHaveLength(1);
    expect(insights.tripBases.trips[0]).toMatchObject({
      houses: 2,
      changes: 2,
      longestBaseNights: 4,
      longestBaseLodgingId: "A",
      overlapNights: 0,
      types: ["campsite", "hotel"],
      completed: true,
    });
  });

  it("reports a night booked at two houses as overlap, not as a move there and back", () => {
    const t = trip("t2");
    const { insights } = computeLodgingInsights(
      [
        stay({ trip: t, lodgingId: "A", checkIn: "2024-08-01", checkOut: "2024-08-04" }),
        stay({ trip: t, lodgingId: "B", checkIn: "2024-08-03", checkOut: "2024-08-05" }),
      ],
      NOW
    );
    expect(insights.tripBases.trips[0]).toMatchObject({ changes: 1, overlapNights: 1 });
  });

  it("reads a second room booked inside the base stay as parallel, not as a move there and back", () => {
    const t = trip("t6");
    const { insights } = computeLodgingInsights(
      [
        stay({ trip: t, lodgingId: "A", checkIn: "2024-09-01", checkOut: "2024-09-10" }),
        stay({ trip: t, lodgingId: "B", checkIn: "2024-09-05", checkOut: "2024-09-06" }),
        stay({ trip: t, lodgingId: "A", checkIn: "2024-09-10", checkOut: "2024-09-12" }),
      ],
      NOW
    );
    expect(insights.tripBases.trips[0]).toMatchObject({ changes: 0, overlapNights: 1 });
  });

  it("only calls a trip completed when nothing of it is still ahead", () => {
    const open = trip("t3", { endDate: d("2027-01-01") });
    const planned = trip("t4");
    const done = trip("t5");
    const { insights } = computeLodgingInsights(
      [
        stay({ trip: open, type: "hotel", lodgingId: "1" }),
        stay({ trip: open, type: "hostel", lodgingId: "2" }),
        stay({ trip: open, type: "campsite", lodgingId: "3" }),
        stay({ trip: open, type: "apartment", lodgingId: "4" }),
        stay({ trip: planned, type: "hotel", lodgingId: "5" }),
        stay({
          trip: planned,
          type: "hostel",
          lodgingId: "6",
          checkIn: "2026-12-01",
          checkOut: "2026-12-02",
        }),
        stay({ trip: done, type: "hotel", lodgingId: "7" }),
        stay({ trip: done, type: "guesthouse", lodgingId: "8" }),
      ],
      NOW
    );
    expect(insights.tripBases.typesPerCompletedTripMax).toBe(2);
    expect(insights.tripBases.trips.find((b) => b.tripId === "t3")?.completed).toBe(false);
  });

  it("leaves stays filed under no trip out and counts them", () => {
    const { insights } = computeLodgingInsights([stay({}), stay({})], NOW);
    expect(insights.tripBases.trips).toEqual([]);
    expect(insights.tripBases.staysWithoutTrip).toBe(2);
  });
});

describe("lodging insights — price per night (item 4)", () => {
  it("compares within one house, room, board and currency, never across currencies", () => {
    const { insights } = computeLodgingInsights(
      [
        stay({
          roomCategory: "Doppel",
          board: "breakfast",
          totalPrice: 200,
          checkIn: "2022-03-01",
          checkOut: "2022-03-03",
        }),
        stay({
          roomCategory: " doppel ",
          board: "breakfast",
          totalPrice: 330,
          checkIn: "2024-03-01",
          checkOut: "2024-03-04",
        }),
        stay({
          roomCategory: "Doppel",
          board: "breakfast",
          totalPrice: 150,
          currency: "CHF",
          checkIn: "2023-03-01",
          checkOut: "2023-03-02",
        }),
        stay({
          roomCategory: "Doppel",
          board: "breakfast",
          totalPrice: 0,
          isAwardStay: true,
          checkIn: "2025-03-01",
          checkOut: "2025-03-02",
        }),
        stay({
          roomCategory: "Doppel",
          board: "breakfast",
          totalPrice: null,
          checkIn: "2025-04-01",
          checkOut: "2025-04-02",
        }),
      ],
      NOW
    );
    expect(insights.priceTrends.groups).toEqual([
      expect.objectContaining({
        currency: "EUR",
        stays: 2,
        first: expect.objectContaining({ perNight: 100, date: "2022-03-01" }),
        last: expect.objectContaining({ perNight: 110, date: "2024-03-01" }),
        changePct: 10,
        thin: true,
      }),
    ]);
    expect(insights.priceTrends.singlePricedStays).toBe(1);
    expect(insights.priceTrends.awardStays).toBe(1);
    expect(insights.priceTrends.unpricedStays).toBe(1);
  });
});

describe("lodging insights — week rhythm and business nights (item 5)", () => {
  it("splits Friday and Saturday nights from the working week on the hotel's own dates", () => {
    // 2024-03-01 is a Friday: Fri, Sat, Sun, Mon nights.
    const { insights, items } = computeLodgingInsights(
      [stay({ checkIn: "2024-03-01", checkOut: "2024-03-05" })],
      NOW
    );
    expect(insights.weekRhythm.weekendNights).toBe(2);
    expect(insights.weekRhythm.weekdayNights).toBe(2);
    const totals = totalsOf(items);
    expect(totals.lodgingWeekendNights).toEqual({ allTime: 2, byYear: { "2024": 2 } });
  });

  it("counts a business night only on a trip marked business, never from the weekday", () => {
    const { insights, items } = computeLodgingInsights(
      [
        stay({
          trip: trip("b", { category: "business" }),
          checkIn: "2024-03-04",
          checkOut: "2024-03-06",
        }),
        stay({ checkIn: "2024-03-11", checkOut: "2024-03-13" }),
        stay({
          trip: trip("v", { category: "vacation" }),
          checkIn: "2024-03-18",
          checkOut: "2024-03-19",
        }),
      ],
      NOW
    );
    expect(insights.weekRhythm.businessNights).toBe(2);
    expect(insights.weekRhythm.unlabelledNights).toBe(2);
    expect(totalsOf(items).lodgingBusinessNights.allTime).toBe(2);
  });
});

describe("lodging insights — the calendar (award LODGING_FULL_CALENDAR)", () => {
  it("fills a month from a month-precise stay but never from a year-precise one", () => {
    const stays = Array.from({ length: 11 }, (_, i) => {
      const m = String(i + 1).padStart(2, "0");
      return stay({ checkIn: `2023-${m}-10`, checkOut: `2023-${m}-11` });
    });
    const yearOnly = stay({
      datePrecision: "YEAR",
      checkIn: "2023-01-01",
      checkOut: "2023-12-31",
      nights: 5,
    });
    const { insights } = computeLodgingInsights([...stays, yearOnly], NOW);
    expect(insights.calendar.monthsInYearMax).toBe(11);

    const december = stay({
      datePrecision: "MONTH",
      checkIn: "2023-12-01",
      checkOut: "2023-12-31",
      nights: 2,
    });
    const full = computeLodgingInsights([...stays, december], NOW).insights.calendar;
    expect(full.fullYears).toEqual([2023]);
    expect(full.monthsInYearMax).toBe(12);
  });
});

describe("lodging insights — evidence items", () => {
  it("lists a house as returning once, with the years it was seen", () => {
    const { items } = computeLodgingInsights(
      [
        stay({ checkIn: "2020-01-01", checkOut: "2020-01-02" }),
        stay({ checkIn: "2022-01-01", checkOut: "2022-01-02" }),
      ],
      NOW
    );
    expect(items.lodgingReturnHouseCount).toEqual([
      expect.objectContaining({
        credits: ["h1"],
        entry: expect.objectContaining({ href: "/lodging/h1" }),
      }),
    ]);
    expect(totalsOf(items).lodgingReturnHouseCount.allTime).toBe(1);
  });
});

describe("lodging insights — the populations behind the tiles (forgejo#258)", () => {
  it("folds each tile's own figure from its items, so tile and panel are one count", () => {
    const fixtures = [
      // 2024: a dated stay over a weekend, Fri 1 – Mon 4 March: 3 nights.
      stay({ checkIn: "2024-03-01", checkOut: "2024-03-04", totalPrice: 300 }),
      // 2024: a month-precise stay, 2 nights in July, no weekdays.
      stay({
        lodgingId: "h2",
        lodgingName: "Haus Zwei",
        datePrecision: "MONTH",
        checkIn: "2024-07-01",
        checkOut: "2024-07-31",
        nights: 2,
      }),
      // A length nobody recorded: in no sleeping-style share.
      stay({
        lodgingId: "h3",
        datePrecision: "MONTH",
        checkIn: "2024-09-01",
        checkOut: "2024-09-30",
        nights: null,
      }),
      // 2025: the same house again, a higher price — one price comparison.
      stay({ checkIn: "2025-03-07", checkOut: "2025-03-10", totalPrice: 360 }),
    ];
    const { insights, items } = computeLodgingInsights(fixtures, NOW);
    const totals = totalsOf(items);

    const sleep2024 = insights.sleepStyle.byYear.find((y) => y.year === 2024)!.nights;
    expect(totals.lodgingSleepStyleNights.byYear["2024"]).toBe(sleep2024);
    expect(sleep2024).toBe(5);

    const week2024 = insights.weekRhythm.byYear.find((y) => y.year === 2024)!;
    expect(totals.lodgingCalendarWeekNights.byYear["2024"]).toBe(
      week2024.weekendNights + week2024.weekdayNights
    );

    const months2024 = insights.calendar.byYear.find((y) => y.year === 2024)!.months.length;
    expect(totals.lodgingCalendarMonthCount.byYear["2024"]).toBe(months2024);
    expect(months2024).toBe(2);

    expect(insights.priceTrends.groups).toHaveLength(1);
    expect(totals.lodgingPriceComparisonCount.allTime).toBe(1);
    expect(items.lodgingPriceComparisonCount[0].entry).toMatchObject({
      href: "/lodging/h1",
      title: { text: "Haus Eins" },
      subtitle: { text: "EUR" },
    });
  });

  it("lists the finished trips the median of moves is read over, and no trip under way", () => {
    const done = trip("t1");
    const running = trip("t2", { endDate: d("2027-01-01") });
    const { insights, items } = computeLodgingInsights(
      [
        stay({ trip: done, checkIn: "2024-05-01", checkOut: "2024-05-03" }),
        stay({ trip: done, lodgingId: "h2", checkIn: "2024-05-03", checkOut: "2024-05-05" }),
        stay({ trip: running, checkIn: "2025-05-01", checkOut: "2025-05-02" }),
      ],
      NOW
    );
    expect(insights.tripBases.trips.filter((b) => b.completed)).toHaveLength(1);
    expect(items.lodgingCompletedTripBaseCount).toEqual([
      expect.objectContaining({
        year: 2024,
        contribution: 1,
        entry: expect.objectContaining({
          domain: "trip",
          href: "/trips/t1",
          subtitle: { key: "evidence.subtitle.tripBase", values: { houses: 2, changes: 1 } },
        }),
      }),
    ]);
  });
});
