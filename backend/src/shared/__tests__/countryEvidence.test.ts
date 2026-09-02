import {
  attestedGroundDays,
  COUNTRY_TIERS,
  countCountries,
  daysBetween,
  foldCountryEvidence,
  groundTier,
  lodgingEvidence,
  measuredGroundMinutes,
  normalizeCountrySet,
  toCountryCode,
  unionCountries,
  type CountableStay,
  type CountryEvidence,
  type CountryTier,
} from "../countryEvidence";

/**
 * The cases that carry a DECISION, not the ones that merely exercise the code.
 *
 * Design: `docs/superpowers/specs/2026-09-02-country-counting-design.md`. Three
 * things below are the reason the module exists at all, and each is a number the
 * owner has already seen move:
 *
 *   1. The name-vs-code join. Union on free text gave 88 countries where union on
 *      ISO codes gives 40 — the same account, counted twice a different way.
 *   2. A lodging with NO stay counts as one night (owner's decision, 2026-09-02).
 *      Five of the owner's countries have no other evidence.
 *   3. A stay whose check-out is still in the future does NOT count. It looks like
 *      case 2 and is its opposite: an absent stay is a forgotten date, a future
 *      stay is a booking.
 *
 * Anything asserted here that later "feels wrong" is a product question for the
 * owner, not a test to relax.
 */

/** Fixed clock — every date below is read relative to this, never to the run. */
const NOW = new Date("2026-09-02T12:00:00Z");
const d = (iso: string): Date => new Date(iso);

/**
 * A stay as the module reads it. `completed` is the column's own default, so
 * every case that is not about cancellation keeps saying exactly what it said
 * before the status started travelling.
 */
const stay = (checkOut: Date | null, status = "completed"): CountableStay => ({
  status,
  checkIn: null,
  checkOut,
});

/** Lookup that fails loudly instead of handing a matcher `undefined`. */
const rowFor = (rows: readonly CountryEvidence[], code: string): CountryEvidence => {
  const row = rows.find((r) => r.code === code);
  if (!row) throw new Error(`expected an evidence row for ${code}, got ${rows.map((r) => r.code)}`);
  return row;
};

describe("COUNTRY_TIERS", () => {
  it("keeps the ranking order the rest of the module reads", () => {
    // The module header says "the order IS the ranking". Reordering this array
    // to taste would silently redefine what the strongest evidence is, and the
    // headline count is a filter on exactly that ranking.
    expect(COUNTRY_TIERS).toEqual(["slept", "visited", "transit"]);
  });
});

describe("foldCountryEvidence — strongest tier wins, once", () => {
  it("reports a country flown through AND slept in as `slept`, in a single row", () => {
    // The bug this replaces counted Austria only because of a 0.9-hour
    // connection while ignoring its nine stays. A country that is both must
    // report the stronger fact — and must not appear twice for the two facts.
    const rows = foldCountryEvidence([
      { country: "AT", kind: "flight", tier: "transit", at: d("2024-03-01") },
      { country: "AT", kind: "lodging", tier: "slept", at: d("2024-07-14") },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe("AT");
    expect(rows[0].tier).toBe<CountryTier>("slept");
    // Both kinds stay listed: a tier alone cannot answer "why is this country
    // in my passport", which is how a wrongly imported hotel was found.
    expect(rows[0].kinds).toEqual(["flight", "lodging"]);
  });

  it("does not let the input order decide the tier", () => {
    // Same two touches, strongest first. A fold that simply kept the last (or
    // the first) writer would pass the test above and fail this one.
    const rows = foldCountryEvidence([
      { country: "AT", kind: "lodging", tier: "slept", at: d("2024-07-14") },
      { country: "AT", kind: "flight", tier: "transit", at: d("2024-03-01") },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].tier).toBe<CountryTier>("slept");
  });

  it("keeps a country whose only evidence is a connection at `transit`", () => {
    // Qatar in the owner's account: 2.2 hours on the ground, nothing else. It
    // must stay countable-but-weak, so the threshold setting can exclude it —
    // dropping it here would take the decision away from the user.
    const rows = foldCountryEvidence([
      { country: "QA", kind: "flight", tier: "transit", at: d("2023-11-02") },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].tier).toBe<CountryTier>("transit");
  });

  it("lists the strongest tier first, then by code, so the UI list is stable", () => {
    const rows = foldCountryEvidence([
      { country: "QA", kind: "flight", tier: "transit", at: d("2023-11-02") },
      { country: "IT", kind: "lodging", tier: "slept", at: d("2022-06-01") },
      { country: "FR", kind: "place", tier: "visited", at: d("2021-05-01") },
      { country: "CZ", kind: "lodging", tier: "slept", at: d("2019-08-01") },
    ]);

    expect(rows.map((r) => r.code)).toEqual(["CZ", "IT", "FR", "QA"]);
  });
});

describe("foldCountryEvidence — joins on codes, never on names", () => {
  it("folds `Deutschland`, `Germany` and `DE` into ONE country", () => {
    // THE 88-vs-40 bug. The achievements unioned airport codes (`DE`) with the
    // free-text `country` column (`Deutschland`, `Germany`) and reported 88
    // countries where the passport reported 32 — measured: 33 ISO codes against
    // 56 distinct strings in one account. Anything that counts joins on the code.
    const rows = foldCountryEvidence([
      { country: "DE", kind: "flight", tier: "visited", at: d("2020-01-05") },
      { country: "Germany", kind: "port", tier: "visited", at: d("2021-02-05") },
      { country: "Deutschland", kind: "lodging", tier: "slept", at: d("2022-03-05") },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe("DE");
    expect(rows[0].tier).toBe<CountryTier>("slept");
    expect(rows[0].kinds).toEqual(["flight", "lodging", "port"]);
  });

  it("folds the other spellings the owner's own data actually holds", () => {
    // Straight out of the design doc's measurement — these are real values from
    // the `country` column, not invented variants.
    const rows = foldCountryEvidence([
      { country: "Österreich", kind: "lodging", tier: "slept", at: null },
      { country: "Austria", kind: "flight", tier: "transit", at: d("2024-03-01") },
      { country: "Schweiz/Suisse/Svizzera/Svizra", kind: "lodging", tier: "slept", at: null },
      { country: "Switzerland", kind: "flight", tier: "visited", at: d("2024-04-01") },
      { country: "Česko", kind: "lodging", tier: "slept", at: null },
      { country: "Tschechien", kind: "lodging", tier: "slept", at: d("2019-08-01") },
    ]);

    expect(rows.map((r) => r.code).sort()).toEqual(["AT", "CH", "CZ"]);
  });

  it("is case- and whitespace-insensitive about a bare code", () => {
    const rows = foldCountryEvidence([
      { country: "it", kind: "lodging", tier: "slept", at: d("2022-06-01") },
      { country: " IT ", kind: "flight", tier: "visited", at: d("2022-06-04") },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe("IT");
  });

  it("contributes NOTHING for a country nobody can resolve, rather than a guess", () => {
    // Same cut `shared/placeCounting.ts` makes: a country a reader cannot check
    // by looking is worse than a missing one. Free text that is not a country,
    // an empty field and a null all drop out — and drop out silently is the
    // point, they must not become a row named after the raw string.
    const rows = foldCountryEvidence([
      { country: "Atlantis", kind: "place", tier: "visited", at: d("2024-01-01") },
      { country: "Nowhere Land", kind: "lodging", tier: "slept", at: d("2024-01-02") },
      { country: "", kind: "flight", tier: "transit", at: d("2024-01-03") },
      { country: null, kind: "flight", tier: "transit", at: d("2024-01-04") },
    ]);

    expect(rows).toEqual([]);
  });

  it("drops an unresolvable touch without dropping the resolvable ones beside it", () => {
    const rows = foldCountryEvidence([
      { country: "Atlantis", kind: "place", tier: "visited", at: d("2024-01-01") },
      { country: "Slovenia", kind: "lodging", tier: "slept", at: d("2024-01-02") },
    ]);

    expect(rows.map((r) => r.code)).toEqual(["SI"]);
  });
});

describe("toCountryCode — the join every consumer now shares", () => {
  /**
   * The guard for step 4 of the design: `utils/achievementStats.ts`,
   * `routes/stats.ts` and `routes/trips.ts` each carried their own version of
   * this join, and each read only ONE of the two resolvers. Neither resolver
   * contains the other, so dropping either loses countries silently — which is
   * why the cases below are stated as a pair rather than as one list.
   */
  it("reads the names ONLY the multilingual resolver carries", () => {
    // The free-text `country` column, in whatever language wrote it. The
    // English-only table behind `utils/continents.ts` resolves none of these.
    expect(toCountryCode("Deutschland")).toBe("DE");
    expect(toCountryCode("Österreich")).toBe("AT");
    expect(toCountryCode("Česko")).toBe("CZ");
    expect(toCountryCode("Schweiz/Suisse/Svizzera/Svizra")).toBe("CH");
  });

  it("reads the catalogue spellings ONLY the English table carries", () => {
    // Port and airport catalogue names `Intl.DisplayNames` does not answer for.
    // A join that kept only the multilingual resolver would drop every one.
    expect(toCountryCode("DR Congo")).toBe("CD");
    expect(toCountryCode("US Virgin Islands")).toBe("VI");
    expect(toCountryCode("Kosovo")).toBe("XK");
    expect(toCountryCode("Macau")).toBe("MO");
    expect(toCountryCode("South Georgia")).toBe("GS");
  });

  it("refuses the catalogue's placeholders and anything that is not a country", () => {
    // `ZZ`/`XZ` pass the multilingual resolver's shape check — two letters is
    // all it asks — so the placeholder guard has to live after both resolvers.
    expect(toCountryCode("ZZ")).toBeNull();
    expect(toCountryCode("XZ")).toBeNull();
    // What `/stats/countries` puts in the display list for an airport with no
    // country on file. It must never become a country in the ISO list beside it.
    expect(toCountryCode("Unknown")).toBeNull();
    expect(toCountryCode("Dubai")).toBeNull();
    expect(toCountryCode(null)).toBeNull();
    expect(toCountryCode(undefined)).toBeNull();
  });

  it("does not publish a two-character string as if it were a code", () => {
    // `isoCountryCode` upper-cases anything two characters long, so calling it
    // alone published "日本" into `countriesIso` as a country code. Asking the
    // multilingual resolver FIRST answers the country the string names.
    expect(toCountryCode("日本")).toBe("JP");
  });
});

describe("normalizeCountrySet / unionCountries", () => {
  it("folds every spelling of one country into one code", () => {
    expect([...normalizeCountrySet(["DE", "Germany", "Deutschland"])]).toEqual(["DE"]);
  });

  it("unions across domains on the code, never on the text", () => {
    // THE 88-vs-40 bug, in its set-shaped form: airports contribute `DE`,
    // ports `Germany`, lodging `Deutschland`, and unioning the strings counts
    // one country three times.
    const union = unionCountries(
      new Set(["DE", "FR"]),
      new Set(["Germany", "Italy"]),
      new Set(["Deutschland", "Atlantis"])
    );

    expect([...union].sort()).toEqual(["DE", "FR", "IT"]);
  });

  it("is idempotent — folding an already-folded set changes nothing", () => {
    const once = normalizeCountrySet(["Deutschland", "FR"]);
    expect([...normalizeCountrySet(once)].sort()).toEqual([...once].sort());
  });
});

describe("foldCountryEvidence — dates and undated evidence", () => {
  it("spans first to last across every contribution", () => {
    const rows = foldCountryEvidence([
      { country: "FR", kind: "flight", tier: "visited", at: d("2021-05-10") },
      { country: "FR", kind: "lodging", tier: "slept", at: d("2018-09-01") },
      { country: "FR", kind: "port", tier: "visited", at: d("2023-02-20") },
    ]);

    expect(rowFor(rows, "FR").firstDate).toBe("2018-09-01");
    expect(rowFor(rows, "FR").lastDate).toBe("2023-02-20");
    expect(rowFor(rows, "FR").hasUndatedEvidence).toBe(false);
  });

  it("flags a country that carries any undated evidence, and still keeps the dates it has", () => {
    // The UI needs this flag to explain a country that can never show up in a
    // year's figures. Without it, an undated house looks like a missing year.
    const rows = foldCountryEvidence([
      { country: "RO", kind: "lodging", tier: "slept", at: null },
      { country: "RO", kind: "flight", tier: "transit", at: d("2015-06-01") },
    ]);

    expect(rowFor(rows, "RO").hasUndatedEvidence).toBe(true);
    expect(rowFor(rows, "RO").firstDate).toBe("2015-06-01");
    expect(rowFor(rows, "RO").lastDate).toBe("2015-06-01");
  });

  it("flags it the same way when the undated touch arrives LAST", () => {
    // The undated branch is a different code path depending on whether the
    // country row already exists; both must set the flag.
    const rows = foldCountryEvidence([
      { country: "RO", kind: "flight", tier: "transit", at: d("2015-06-01") },
      { country: "RO", kind: "lodging", tier: "slept", at: null },
    ]);

    expect(rowFor(rows, "RO").hasUndatedEvidence).toBe(true);
    expect(rowFor(rows, "RO").firstDate).toBe("2015-06-01");
  });

  it("reports no dates at all when nothing carried one", () => {
    // The Bucharest case: `Hotel Sport`, one house, zero stays, wrong country.
    // It counts (decision of 2026-09-02) and it is dateless — which is exactly
    // the signal that let a reader find the bad row.
    const rows = foldCountryEvidence([{ country: "RO", kind: "lodging", tier: "slept", at: null }]);

    expect(rowFor(rows, "RO")).toMatchObject({
      tier: "slept",
      firstDate: null,
      lastDate: null,
      hasUndatedEvidence: true,
    });
  });

  it("treats a missing `at` the same as an explicit null", () => {
    const rows = foldCountryEvidence([{ country: "RO", kind: "lodging", tier: "slept" }]);

    expect(rowFor(rows, "RO").hasUndatedEvidence).toBe(true);
    expect(rowFor(rows, "RO").firstDate).toBeNull();
  });

  it("returns an empty list for no input at all, not a row for nobody", () => {
    expect(foldCountryEvidence([])).toEqual([]);
  });
});

describe("countCountries", () => {
  /** One country per tier — the smallest set that can tell the thresholds apart. */
  const EVIDENCE = foldCountryEvidence([
    { country: "CZ", kind: "lodging", tier: "slept", at: d("2019-08-01") },
    { country: "FR", kind: "place", tier: "visited", at: d("2021-05-01") },
    { country: "QA", kind: "flight", tier: "transit", at: d("2023-11-02") },
  ]);

  it("counts everything from `transit`", () => {
    expect(countCountries(EVIDENCE, "transit")).toBe(3);
  });

  it("excludes connections from `visited` — the default the design proposes", () => {
    // "A country counts as visited from … ○ transit ○ stay (default) ○ overnight".
    // Seven of the owner's countries are connections under five hours; this is
    // the setting that decides whether they belong in the headline.
    expect(countCountries(EVIDENCE, "visited")).toBe(2);
    expect(countCountries(EVIDENCE)).toBe(2);
  });

  it("counts only overnights from `slept`", () => {
    expect(countCountries(EVIDENCE, "slept")).toBe(1);
  });

  it("never counts a country twice, whatever the threshold", () => {
    // The whole point of folding first: a country with four touches is one
    // country. This is the shape of the 88-vs-40 failure, one tier lower.
    const folded = foldCountryEvidence([
      { country: "DE", kind: "flight", tier: "transit", at: d("2020-01-05") },
      { country: "Germany", kind: "port", tier: "visited", at: d("2021-02-05") },
      { country: "Deutschland", kind: "lodging", tier: "slept", at: d("2022-03-05") },
      { country: "DE", kind: "place", tier: "visited", at: d("2022-03-06") },
    ]);

    expect(COUNTRY_TIERS.map((tier) => countCountries(folded, tier))).toEqual([1, 1, 1]);
  });
});

describe("lodgingEvidence", () => {
  it("counts a lodging with NO stays as `slept` and undated — owner's decision of 2026-09-02", () => {
    // A DECISION, not a derivation, and the reason this module exists: somebody
    // took the trouble to enter the house, so they were there — they simply no
    // longer remember when. Three countries in the owner's account (Czechia,
    // Italy, Slovenia) exist only through lodging; five more only through houses
    // like this one. The price is named in the design: data quality now decides
    // the count, which is why the evidence stays visible.
    expect(lodgingEvidence([], NOW)).toEqual({ tier: "slept", at: null, days: [] });
  });

  it("does NOT count a stay whose check-out is in the future — that is a booking", () => {
    // The boundary that stops the decision above from swallowing bookings. The
    // two look alike and are not: an ABSENT stay is a forgotten date, a FUTURE
    // stay is a plan. `shared/lodgingCounting.ts` already states this rule and
    // this must not diverge from it.
    expect(lodgingEvidence([stay(d("2026-12-24"))], NOW)).toBeNull();
  });

  it("does not count a stay that is still running — the rule is 'until the check-out is past'", () => {
    // Checked in yesterday, checking out next week. Same cut as `classifyStay`:
    // the night is not over, so it is not yet evidence.
    expect(lodgingEvidence([stay(d("2026-09-09"))], NOW)).toBeNull();
  });

  it("counts a stay already checked out as `slept`, dated with the earliest past check-out", () => {
    expect(lodgingEvidence([stay(d("2024-05-04"))], NOW)).toEqual({
      tier: "slept",
      at: d("2024-05-04"),
      // No check-in on this fixture, so the stay names only the day it ended.
      // Stretching it back would invent nights nobody recorded.
      days: ["2024-05-04"],
    });
  });

  it("dates a country from the EARLIEST past check-out, not the newest", () => {
    // `firstDate` on the folded row is what a "new countries this year" figure
    // reads. Taking the latest check-out would move a country the user first
    // saw in 2018 into whichever year they last returned.
    expect(
      lodgingEvidence([stay(d("2024-05-04")), stay(d("2018-07-01")), stay(d("2021-02-02"))], NOW)
    ).toEqual({
      tier: "slept",
      at: d("2018-07-01"),
      // `at` is the earliest; the DAYS are all of them. The two answer
      // different questions and neither may be read off the other.
      days: ["2018-07-01", "2021-02-02", "2024-05-04"],
    });
  });

  it("counts mixed stays from the past one, ignoring the one still to come", () => {
    expect(lodgingEvidence([stay(d("2026-12-24")), stay(d("2024-05-04"))], NOW)).toEqual({
      tier: "slept",
      at: d("2024-05-04"),
      // The booking contributes no day either: it has not happened.
      days: ["2024-05-04"],
    });
  });

  it("counts a check-out exactly at `now` — the night is over", () => {
    // Boundary pinned deliberately: `<=`, not `<`. A stay that ends this instant
    // has happened, and the alternative flickers a country in and out of the
    // count over a millisecond.
    expect(lodgingEvidence([stay(NOW)], NOW)).toEqual({
      tier: "slept",
      at: NOW,
      days: ["2026-09-02"],
    });
  });

  it("counts a house whose only stay carries no check-out date, undated", () => {
    // The gap this test was written to expose, now closed by decision. A stay
    // with no check-out is the same situation as no stay: somebody recorded
    // having been here and did not record when. The old behaviour meant that
    // ADDING a dateless stay row removed the country — the opposite of what
    // recording a stay should ever do.
    //
    // Deliberately NOT the future-booking case below: a null check-out does not
    // say "not yet", it says "I don't remember".
    expect(lodgingEvidence([stay(null)], NOW)).toEqual({
      tier: "slept",
      at: null,
      // It proves the country without proving a single day of it — which is
      // exactly what `hasUndatedEvidence` exists to tell the reader.
      days: [],
    });
  });

  it("still refuses a house whose stays are all bookings yet to come", () => {
    // The boundary that keeps the decision above from swallowing the future.
    expect(lodgingEvidence([stay(d("2027-03-05"))], NOW)).toBeNull();
  });

  it("counts a dateless stay even when another stay is still to come", () => {
    // Mixed: one "I don't remember" and one booking. The first is evidence, the
    // second is not, so the house counts — undated.
    expect(lodgingEvidence([stay(null), stay(d("2027-03-05"))], NOW)).toEqual({
      tier: "slept",
      at: null,
      days: [],
    });
  });

  it("defaults `now` to the current clock", () => {
    // Every caller in the passport path passes a fixed `now`; the default exists
    // for the ones that do not, and a stay from 2020 must not depend on it.
    expect(lodgingEvidence([stay(d("2020-01-05"))])).toEqual({
      tier: "slept",
      at: d("2020-01-05"),
      days: ["2020-01-05"],
    });
    expect(lodgingEvidence([stay(d("2099-01-05"))])).toBeNull();
  });
});

describe("lodgingEvidence — a cancelled stay is not a night", () => {
  it("does NOT count a house whose only stay was cancelled, even with a past check-out", () => {
    // THE DEFECT. Only `checkOut` reached this module, so a cancelled booking
    // whose dates had come and gone read as "checked out in the past" and proved
    // a country. The record says the opposite: the visit did not happen.
    expect(lodgingEvidence([stay(d("2024-05-04"), "cancelled")], NOW)).toBeNull();
  });

  it("does not fold an all-cancelled house into the no-stay case, which COUNTS", () => {
    // The trap that made this un-fixable in the caller, and the reason the
    // status travels instead of a filter. Dropping cancellations from the query
    // leaves a house with an EMPTY stay list — and an empty list counts as one
    // night under the owner's decision. Cancelling a booking would then be the
    // act that put a country in the passport.
    expect(lodgingEvidence([], NOW)).toEqual({ tier: "slept", at: null, days: [] });
    expect(lodgingEvidence([stay(d("2024-05-04"), "cancelled")], NOW)).toBeNull();
    expect(lodgingEvidence([stay(null, "cancelled")], NOW)).toBeNull();
  });

  it("still counts the house when one stay was cancelled and another happened", () => {
    // Only the cancelled stay drops out. The house keeps the night it did have,
    // dated from the stay that was not called off.
    expect(
      lodgingEvidence([stay(d("2018-07-01"), "cancelled"), stay(d("2024-05-04"))], NOW)
    ).toEqual({ tier: "slept", at: d("2024-05-04"), days: ["2024-05-04"] });
  });

  it("does not let a cancelled stay date the country it does not prove", () => {
    // `at` is what a "first visited" year reads. A cancellation earlier than
    // every real stay must not pull the country's first date back to a trip
    // nobody took.
    expect(
      lodgingEvidence([stay(d("2005-01-01"), "cancelled"), stay(d("2021-02-02"))], NOW)
    ).toEqual({
      tier: "slept",
      at: d("2021-02-02"),
      // And it contributes no DAY either — the cancelled night is not present
      // in the count any more than it is in the date.
      days: ["2021-02-02"],
    });
  });

  it("reads only a real cancellation, not a stale scheduled/completed cache", () => {
    // `LODGING_PASSTHROUGH` is the whole vocabulary here: "cancelled" is the one
    // lodging status that is a user STATEMENT, every other one is a cache of the
    // dates that an hourly sweep converges. A stay from 2024 still stored as
    // "scheduled" between sweeps is evidence; only the cancellation is not.
    expect(lodgingEvidence([stay(d("2024-05-04"), "scheduled")], NOW)).toEqual({
      tier: "slept",
      at: d("2024-05-04"),
      days: ["2024-05-04"],
    });
    expect(lodgingEvidence([stay(d("2024-05-04"), "in_progress")], NOW)).toEqual({
      tier: "slept",
      at: d("2024-05-04"),
      days: ["2024-05-04"],
    });
  });
});

describe("groundTier", () => {
  it("calls the same local day `visited`", () => {
    // Landed 07:00, took off again 11:00, same date at the airport's clock: a
    // connection or a day out — the data cannot tell, so it is not `slept`.
    expect(groundTier("2024-03-01", "2024-03-01")).toBe<CountryTier>("visited");
  });

  it("calls a changed local day `slept`", () => {
    // "Different calendar day" is IN the data; "six hours" is a guess. Measured
    // on the owner's account, six hours and twelve hours return the same set of
    // countries — a configurable threshold would promise precision we lack.
    expect(groundTier("2024-03-01", "2024-03-02")).toBe<CountryTier>("slept");
  });

  it("takes local day STRINGS, so a red-eye is not moved into the wrong day", () => {
    // The reason the signature is strings and not Dates. A 23:30 local arrival
    // in Tokyo is already the NEXT UTC day; comparing UTC instants would report
    // an overnight for a two-hour connection. The caller resolves the airport's
    // clock, this function only compares what it was handed.
    expect(groundTier("2024-03-02", "2024-03-02")).toBe<CountryTier>("visited");
    expect(typeof groundTier("2024-03-02", "2024-03-03")).toBe("string");
  });

  it("does not call a backwards day pair `slept`", () => {
    // Crossing the date line westbound can land a departure on an EARLIER local
    // day than the arrival. That is not an overnight; without the guard a `!==`
    // comparison would say it is.
    expect(groundTier("2024-03-02", "2024-03-01")).toBe<CountryTier>("visited");
  });

  it("spans a month and a year boundary the same way — the comparison is ISO, not numeric", () => {
    expect(groundTier("2024-03-31", "2024-04-01")).toBe<CountryTier>("slept");
    expect(groundTier("2024-12-31", "2025-01-01")).toBe<CountryTier>("slept");
  });
});

/**
 * Spec §3.4b — the two figures that stand beside the tier.
 *
 * The rule they exist to hold is one line long and the whole design rests on
 * it: a value that cannot be derived is absent, never zero. A country proved
 * only by a hotel has an UNKNOWN ground time, and `0 h` there would be a
 * measurement nobody made.
 */
describe("daysBetween", () => {
  it("expands a span inclusively, so a stay from the 1st to the 4th is four days", () => {
    // DAYS, not nights. Three nights were slept; four days had the traveller in
    // the country, and days are what every evidence kind can answer.
    expect(daysBetween("2024-05-01", "2024-05-04")).toEqual([
      "2024-05-01",
      "2024-05-02",
      "2024-05-03",
      "2024-05-04",
    ]);
  });

  it("crosses a month and a leap day by the calendar, not by arithmetic on the string", () => {
    expect(daysBetween("2024-02-28", "2024-03-01")).toEqual([
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
    ]);
  });

  it("gives one day for a single day", () => {
    expect(daysBetween("2024-05-01", "2024-05-01")).toEqual(["2024-05-01"]);
  });

  it("does not count backwards when a record contradicts itself", () => {
    // A check-out before its check-in is the §3.5 inbox case. Counting the span
    // would turn a typo into a negative number; inventing the days between them
    // would turn it into evidence.
    expect(daysBetween("2024-05-04", "2024-05-01")).toEqual(["2024-05-04"]);
  });

  it("names only the two ends of an impossible span", () => {
    // A decade of continuous presence is a broken record, not a long holiday.
    // Reporting the two days it actually names is the honest floor; 3661 would
    // be a fabrication with a lot of decimal places.
    expect(daysBetween("2000-01-01", "2030-01-01")).toEqual(["2000-01-01", "2030-01-01"]);
  });
});

/**
 * A spell between two flights is not a stay — owner's decision, 2026-09-02.
 *
 * Ground time measures the ABSENCE OF A RECORDED DEPARTURE, not presence. The
 * defect these pin was measured on the beta server: an account's home country
 * reported `daysPresent: 2200` and 3,136,245 ground minutes (5.5 years), from a
 * landing in Munich on 2020-01-26 and the next German departure on 2025-07-16.
 * Both figures were literally correct and both were nonsense, and the shape is
 * guaranteed for the one country every user has.
 */
describe("attestedGroundDays", () => {
  it("names the two ends of a years-long gap, never the range between them", () => {
    // THE 2200-DAY DEFECT. The records attest the day of the landing and the
    // day of the next departure. About the two thousand days in between they
    // say nothing at all, and `daysBetween` would have counted every one.
    expect(attestedGroundDays("2020-01-26", "2025-07-16")).toEqual(["2020-01-26", "2025-07-16"]);
  });

  it("gives a same-day connection exactly one day", () => {
    expect(attestedGroundDays("2024-03-01", "2024-03-01")).toEqual(["2024-03-01"]);
  });

  it("gives an overnight two days — the endpoints ARE the whole span here", () => {
    // Which is why the rule is not a special case for long spells: for every
    // spell short enough to believe, the endpoints and the range agree.
    expect(attestedGroundDays("2024-03-01", "2024-03-02")).toEqual(["2024-03-01", "2024-03-02"]);
  });

  it("names only the arrival when the record contradicts itself", () => {
    // A departure before the arrival, as `daysBetween` treats the same shape.
    expect(attestedGroundDays("2024-03-04", "2024-03-01")).toEqual(["2024-03-04"]);
  });
});

describe("measuredGroundMinutes", () => {
  it("publishes a same-day connection", () => {
    expect(measuredGroundMinutes("2024-03-01", "2024-03-01", 180)).toBe(180);
  });

  it("publishes a 25-hour stopover — one night is still a stay", () => {
    // The contrast §3.4b exists to draw, and the reason the boundary is one
    // night rather than none: the owner's connection countries run 1.4 h–4.7 h
    // and the next country is France at 25 h. Losing France's figure would
    // delete the finding.
    expect(measuredGroundMinutes("2024-03-01", "2024-03-02", 1500)).toBe(1500);
  });

  it("abstains beyond one night, however plausible the number looks", () => {
    // Two nights is where the interval stops describing a stay and starts
    // describing a hole in the flight log. `null` becomes `unknown` in the
    // fold — "add the missing flight" — and never a zero.
    expect(measuredGroundMinutes("2024-03-01", "2024-03-03", 3000)).toBeNull();
  });

  it("abstains for the 5.5-year home-country gap", () => {
    expect(measuredGroundMinutes("2020-01-26", "2025-07-16", 3_136_245)).toBeNull();
  });

  it("abstains where nothing was measured, and where the record runs backwards", () => {
    expect(measuredGroundMinutes("2024-03-01", "2024-03-01", null)).toBeNull();
    expect(measuredGroundMinutes("2024-03-01", "2024-03-01", undefined)).toBeNull();
    expect(measuredGroundMinutes("2024-03-04", "2024-03-01", 120)).toBeNull();
  });

  it("keeps a measured zero, because zero is only forbidden as a stand-in", () => {
    expect(measuredGroundMinutes("2024-03-01", "2024-03-01", 0)).toBe(0);
  });
});

describe("foldCountryEvidence — days present and ground time", () => {
  it("unions the days, so the same day proved twice is one day", () => {
    const rows = foldCountryEvidence([
      { country: "DE", kind: "flight", tier: "visited", at: d("2024-03-01"), days: ["2024-03-01"] },
      { country: "DE", kind: "place", tier: "visited", at: d("2024-03-01") },
    ]);
    expect(rowFor(rows, "DE").daysPresent).toBe(1);
  });

  it("counts a day from ANY kind that carries one, not only from a flight", () => {
    // Why the design prefers days to hours: an hour exists for a flight pair
    // alone, a day exists for a house, a port call and a place as well.
    const rows = foldCountryEvidence([
      {
        country: "SI",
        kind: "lodging",
        tier: "slept",
        at: d("2019-08-04"),
        days: ["2019-08-01", "2019-08-02", "2019-08-03", "2019-08-04"],
      },
    ]);
    expect(rowFor(rows, "SI").daysPresent).toBe(4);
  });

  it("falls back to the day of `at` when a record names no span", () => {
    const rows = foldCountryEvidence([
      { country: "IT", kind: "place", tier: "visited", at: d("2023-07-04") },
    ]);
    expect(rowFor(rows, "IT").daysPresent).toBe(1);
  });

  it("counts no days for undated evidence — zero, and it says so beside it", () => {
    const rows = foldCountryEvidence([{ country: "CZ", kind: "lodging", tier: "slept", at: null }]);
    expect(rowFor(rows, "CZ")).toMatchObject({ daysPresent: 0, hasUndatedEvidence: true });
  });

  it("reports notApplicable where no flight touched the country", () => {
    // THE RULE. A house, a port call and a place bound no departure. There is
    // no ground time to abstain from — there is none to have.
    const rows = foldCountryEvidence([
      { country: "CZ", kind: "lodging", tier: "slept", at: d("2019-08-04") },
      { country: "IT", kind: "port", tier: "visited", at: d("2023-07-04") },
    ]);
    expect(rowFor(rows, "CZ").groundTime).toEqual({ state: "notApplicable" });
    expect(rowFor(rows, "IT").groundTime).toEqual({ state: "notApplicable" });
  });

  it("reports unknown where a flight touched the country but nothing measured a spell", () => {
    // A different fact, and it asks the reader for something: adding the return
    // leg would answer it. "No flight ever came here" does not.
    const rows = foldCountryEvidence([
      { country: "SG", kind: "flight", tier: "visited", at: d("2024-03-01") },
    ]);
    expect(rowFor(rows, "SG").groundTime).toEqual({ state: "unknown" });
  });

  it("publishes the LONGEST measured spell, raw", () => {
    // No buckets — §3.4b decided that from the data: the connection countries
    // run 1.4 h to 4.7 h and the next is 25 h, so bins would sit permanently
    // empty and hide the gap, which is the finding.
    const rows = foldCountryEvidence([
      {
        country: "QA",
        kind: "flight",
        tier: "transit",
        at: d("2024-03-01"),
        groundMinutes: 132,
      },
      {
        country: "QA",
        kind: "flight",
        tier: "transit",
        at: d("2024-06-01"),
        groundMinutes: 282,
      },
    ]);
    expect(rowFor(rows, "QA").groundTime).toEqual({ state: "measured", minutes: 282 });
  });

  it("does not let a house beside a flight turn an unknown ground time into a zero", () => {
    // The mixed country. A hotel adds days and proves the tier; it adds no
    // minutes, and it must not make the missing measurement look like one.
    const rows = foldCountryEvidence([
      { country: "AT", kind: "flight", tier: "transit", at: d("2024-03-01") },
      { country: "AT", kind: "lodging", tier: "slept", at: d("2019-08-04") },
    ]);
    expect(rowFor(rows, "AT").groundTime).toEqual({ state: "unknown" });
  });

  it("keeps a measured zero-length spell as measured, not as unknown", () => {
    // Zero is only forbidden as a STAND-IN for a missing measurement. A spell
    // that really did measure under a minute is a fact, and abstaining from it
    // would be the same dishonesty in the other direction.
    const rows = foldCountryEvidence([
      { country: "QA", kind: "flight", tier: "transit", at: d("2024-03-01"), groundMinutes: 0 },
    ]);
    expect(rowFor(rows, "QA").groundTime).toEqual({ state: "measured", minutes: 0 });
  });
});
