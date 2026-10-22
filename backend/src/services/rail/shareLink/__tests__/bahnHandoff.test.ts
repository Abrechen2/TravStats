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

  it("refuses an impossible clock instead of rolling it over", () => {
    expect(parseHinfahrtRecon(RECON.replace("202611030808", "202613030808"))).toBeNull();
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
