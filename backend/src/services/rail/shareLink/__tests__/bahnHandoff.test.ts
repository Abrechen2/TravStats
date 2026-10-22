import { parseHinfahrtRecon, MAX_RECON_LENGTH } from "../dbRecon";
import { connectionFromAnswer, fetchDbConnection } from "../dbConnection";
import { resolveBahnHandoff } from "..";

jest.mock("../../parser/railCandidates", () => ({
  toRailCandidate: jest.fn(async (booking: { legs: unknown[] }) => ({ ...booking })),
}));

/**
 * A `hinfahrtRecon` in the shape a tester's real bahn.de answer carried on
 * 2026-10-16 (forgejo#204): a regional train into München Hbf, a walk to the
 * deep station, the S-Bahn to the airport. Public stations and EVA numbers; the
 * day and the train number are invented, so it is no one's real ride.
 */
const RECON =
  "¶HKI¶" +
  "T$A=1@O=Augsburg Hbf@X=10885568@Y=48365444@U=80@L=8000013@a=128@" +
  "$A=1@O=München Hbf@X=11558339@Y=48140229@U=80@L=8000261@a=128@" +
  "$202611030808$202611030854$RB 57099$$1$$$$$$§" +
  "W$A=1@O=München Hbf@L=8000261@a=128@$A=1@O=München Hbf (tief)@L=8004128@a=128@" +
  "$202611030854$202611030901$$$1$$$$$$§" +
  "T$A=1@O=München Hbf (tief)@L=8004128@a=128@$A=1@O=München Flughafen Terminal@L=8004168@a=128@" +
  "$202611030942$202611031028$S      1$$1$$$$$$" +
  "¶KC¶#VE#2#CF#100#CA#0#CM#0#SICT#0#AM#16391#AM2#0#RT#7#¶KCC¶I1ZFIzEjRVJHIzEjSElOIz";

describe("parseHinfahrtRecon", () => {
  it("reads every section — trains, the walk, stations with EVA numbers, wall clocks", () => {
    const sections = parseHinfahrtRecon(RECON);
    expect(sections).toEqual([
      {
        kind: "vehicle",
        from: { name: "Augsburg Hbf", stationId: "8000013" },
        to: { name: "München Hbf", stationId: "8000261" },
        departureLocal: "2026-11-03T08:08",
        arrivalLocal: "2026-11-03T08:54",
        vehicleName: "RB 57099",
      },
      {
        kind: "walk",
        from: { name: "München Hbf", stationId: "8000261" },
        to: { name: "München Hbf (tief)", stationId: "8004128" },
        departureLocal: "2026-11-03T08:54",
        arrivalLocal: "2026-11-03T09:01",
        vehicleName: null,
      },
      {
        kind: "vehicle",
        from: { name: "München Hbf (tief)", stationId: "8004128" },
        to: { name: "München Flughafen Terminal", stationId: "8004168" },
        departureLocal: "2026-11-03T09:42",
        arrivalLocal: "2026-11-03T10:28",
        vehicleName: "S 1",
      },
    ]);
  });

  it("refuses a string with one unreadable section rather than dropping it", () => {
    expect(parseHinfahrtRecon(RECON.replace("$202611030942$", "$2026-11-03$"))).toBeNull();
    expect(parseHinfahrtRecon(RECON.replace("@O=Augsburg Hbf", ""))).toBeNull();
    expect(parseHinfahrtRecon("no recon at all")).toBeNull();
    expect(parseHinfahrtRecon("¶HKI¶")).toBeNull();
    expect(parseHinfahrtRecon("¶HKI¶" + "x".repeat(MAX_RECON_LENGTH))).toBeNull();
  });

  it("refuses an impossible clock or calendar day instead of rolling it over", () => {
    expect(parseHinfahrtRecon(RECON.replace("202611030808", "202613030808"))).toBeNull();
    expect(parseHinfahrtRecon(RECON.replace("202611030808", "202602300808"))).toBeNull();
    expect(parseHinfahrtRecon(RECON.replace("202611030808", "202702290808"))).toBeNull();
    expect(parseHinfahrtRecon(RECON.replace("202611030808", "202611000808"))).toBeNull();
    // 2028 is a leap year: 29 February exists.
    expect(parseHinfahrtRecon(RECON.replace("202611030808", "202802290808"))).not.toBeNull();
  });

  it("refuses a train it cannot name and a section kind it does not know, rather than dropping them", () => {
    // Codex review: an unnamed vehicle became a walk, and the ride read "successfully" without it.
    expect(parseHinfahrtRecon(RECON.replace("$RB 57099$", "$$"))).toBeNull();
    expect(parseHinfahrtRecon(RECON.replace("§W$", "§X$"))).toBeNull();
    // HAFAS writes a footpath as G@F as well as W.
    expect(parseHinfahrtRecon(RECON.replace("§W$", "§G@F$"))?.[1].kind).toBe("walk");
  });
});

describe("resolveBahnHandoff", () => {
  it("turns the recon into the two train rides for the review, the walk left out", async () => {
    const outcome = await resolveBahnHandoff(
      { hinfahrtRecon: RECON, klasse: "KLASSE_2" },
      "user-1"
    );
    expect(outcome).toMatchObject({
      outcome: "read",
      facts: {
        departureStationName: "Augsburg Hbf",
        arrivalStationName: "München Flughafen Terminal",
        departureLocal: "2026-11-03T08:08",
        travelClass: "second",
      },
      booking: {
        source: "db-share-link",
        bookingReference: null,
        price: null,
        travelClass: "second",
        legs: [
          {
            depStationName: "Augsburg Hbf",
            arrStationName: "München Hbf",
            departureLocal: "2026-11-03T08:08",
            arrivalLocal: "2026-11-03T08:54",
            trainCategory: "RB",
            trainNumber: "57099",
          },
          {
            depStationName: "München Hbf (tief)",
            arrStationName: "München Flughafen Terminal",
            departureLocal: "2026-11-03T09:42",
            arrivalLocal: "2026-11-03T10:28",
            trainCategory: "S",
            trainNumber: "1",
          },
        ],
      },
    });
  });

  it("reads web-client sections the same way a server fetch does", async () => {
    const answer = {
      verbindungsAbschnitte: [
        {
          abfahrtsOrt: "Augsburg Hbf",
          ankunftsOrt: "München Hbf",
          abfahrtsZeitpunkt: "2026-11-03T08:08:00",
          ankunftsZeitpunkt: "2026-11-03T08:54:00",
          verkehrsmittel: { name: "RB 57099", typ: "REGIONALZUEGE" },
        },
        {
          abfahrtsOrt: "München Hbf",
          ankunftsOrt: "München Hbf (tief)",
          abfahrtsZeitpunkt: "2026-11-03T08:54:00",
          verkehrsmittel: { typ: "WALK" },
        },
      ],
    };
    const outcome = await resolveBahnHandoff(answer, undefined);
    expect(outcome.outcome).toBe("read");
    expect(outcome.outcome === "read" && outcome.booking.legs).toHaveLength(1);
  });

  it("names an answer that is no connection, and one with only a walk in it", async () => {
    expect(await resolveBahnHandoff({ hinfahrtRecon: "¶HKI¶garbage" }, undefined)).toMatchObject({
      outcome: "failed",
      reason: "unreadable",
    });
    expect(await resolveBahnHandoff({}, undefined)).toMatchObject({ reason: "unreadable" });
    const walkOnly = "¶HKI¶" + RECON.split("§")[1];
    expect(await resolveBahnHandoff({ hinfahrtRecon: walkOnly }, undefined)).toMatchObject({
      outcome: "failed",
      reason: "noTrain",
    });
  });
});

describe("resolveBahnHandoff with a section it cannot classify", () => {
  // Codex review before 2.7.0-rc.20: a section with no vehicle, or a vehicle
  // type without a name, was dropped as "no train" and the ride read as
  // complete — even when the recon beside it carried every leg.
  const train = {
    abfahrtsOrt: "Augsburg Hbf",
    ankunftsOrt: "München Hbf",
    abfahrtsZeitpunkt: "2026-11-03T08:08:00",
    ankunftsZeitpunkt: "2026-11-03T08:54:00",
    verkehrsmittel: { name: "RB 57099", typ: "REGIONALZUEGE" },
  };
  const second = {
    abfahrtsOrt: "München Hbf (tief)",
    ankunftsOrt: "München Flughafen Terminal",
    abfahrtsZeitpunkt: "2026-11-03T09:42:00",
    ankunftsZeitpunkt: "2026-11-03T10:28:00",
  };

  it.each([
    ["no vehicle at all", second],
    ["an empty vehicle (what the bookmarklet sends for none)", { ...second, verkehrsmittel: {} }],
    ["a vehicle type without a name or number", { ...second, verkehrsmittel: { typ: "S" } }],
  ])("refuses a ride with %s instead of reading it partially", async (_label, odd) => {
    const outcome = await resolveBahnHandoff({ verbindungsAbschnitte: [train, odd] }, undefined);
    expect(outcome).toMatchObject({ outcome: "failed", reason: "unreadable" });
  });

  it("falls back to the recon when the sections cannot all be classified", async () => {
    const outcome = await resolveBahnHandoff(
      { verbindungsAbschnitte: [train, second], hinfahrtRecon: RECON },
      undefined
    );
    expect(outcome.outcome).toBe("read");
    expect(outcome.outcome === "read" && outcome.booking.legs).toHaveLength(2);
  });
});

describe("resolveBahnHandoff with an impossible section time", () => {
  // Codex review before 2.7.0-rc.20: section times were checked by prefix only,
  // so 30 February, 29:99 and trailing text read as a ride.
  const ride = (abfahrtsZeitpunkt: string) => ({
    verbindungsAbschnitte: [
      {
        abfahrtsOrt: "Augsburg Hbf",
        ankunftsOrt: "München Hbf",
        abfahrtsZeitpunkt,
        ankunftsZeitpunkt: "2026-11-03T08:54:00",
        verkehrsmittel: { name: "RB 57099" },
      },
    ],
  });

  it.each([
    "2026-02-30T08:08:00",
    "2026-11-03T29:99:00",
    "2026-11-03T08:08:61",
    "2026-11-03T08:08junk",
  ])("refuses %s, the same as the recon would", async (time) => {
    expect(await resolveBahnHandoff(ride(time), undefined)).toMatchObject({
      outcome: "failed",
      reason: "unreadable",
    });
  });

  it.each([
    "2026-11-03T08:08",
    "2026-11-03T08:08:00",
    "2026-11-03T08:08:00.000",
    "2026-11-03T08:08:00+01:00",
    "2028-02-29T08:08:00",
  ])("reads %s on the station's clock", async (time) => {
    const outcome = await resolveBahnHandoff(ride(time), undefined);
    expect(outcome.outcome === "read" && outcome.booking.legs[0].departureLocal).toBe(
      `${time.slice(0, 10)}T08:08`
    );
  });
});

describe("fetchDbConnection with a recon-only answer", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("reads the same connection the bookmarklet would hand over", async () => {
    const body = JSON.stringify({ hinfahrtRecon: RECON, klasse: "KLASSE_1" });
    global.fetch = jest.fn(async () => new Response(body, { status: 200 })) as typeof fetch;
    const fetched = await fetchDbConnection("0f0e0d0c-0b0a-4908-8706-050403020100");
    expect(fetched).toMatchObject({ ok: true, travelClass: "first" });
    expect(fetched.ok && fetched.connection).toEqual(
      connectionFromAnswer({ hinfahrtRecon: RECON })
    );
  });
});

describe("resolveBahnHandoff with a train bahn.de names by number only", () => {
  // The shape of a real bahn.de answer (2.7.0-beta.24 browser test): the
  // regional train carries no category, only its number, padded with blanks.
  // Day invented, so it is no one's real ride.
  const BARE =
    "¶HKI¶" +
    "T$A=1@O=Augsburg Hbf@X=10885568@Y=48365444@L=8000013@a=128@" +
    "$A=1@O=München Hbf@X=11558339@Y=48140229@L=8000261@a=128@" +
    "$202611030808$202611030854$            57031$$1$$$$$$§" +
    "T$A=1@O=München Hbf (tief)@L=8098263@a=128@$A=1@O=München Flughafen Terminal@L=8004168@a=128@" +
    "$202611030942$202611031028$               S1$$1$$$$$$" +
    "¶KC¶#VE#2#RT#7#";

  it("keeps the number as the train number and invents no category", async () => {
    const outcome = await resolveBahnHandoff({ hinfahrtRecon: BARE }, "user-1");
    expect(outcome).toMatchObject({ outcome: "read" });
    const legs = outcome.outcome === "read" ? outcome.booking.legs : [];
    expect(legs.map((l) => [l.trainCategory, l.trainNumber])).toEqual([
      [null, "57031"],
      ["S", "1"],
    ]);
  });
});
