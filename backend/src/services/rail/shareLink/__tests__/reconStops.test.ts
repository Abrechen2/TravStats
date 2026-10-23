import { parseHinfahrtRecon, reconCategoryCodes } from "../dbRecon";
import { bookingFromConnection, connectionFromAnswer } from "../dbConnection";
import { ALEX_ANSWER, ALEX_RECON } from "./fixtures/dbConnectionAnswer";

/**
 * What a real bahn.de answer says about its stops and vehicles (2026-10-23):
 * EVA numbers, positions in microdegrees, and each vehicle's HAFAS category in
 * the base64 `¶KCC¶` block — all of it kept through to the review's legs.
 */
describe("the stops and vehicles of a real recon", () => {
  it("converts @X/@Y microdegrees to degrees and keeps the EVA numbers", () => {
    const sections = parseHinfahrtRecon(ALEX_RECON)!;
    expect(sections.map((s) => [s.from.stationId, s.from.position])).toEqual([
      ["8000013", { lat: 48.365444, lon: 10.885568 }],
      ["8000261", { lat: 48.140229, lon: 11.558339 }],
      ["8098263", { lat: 48.141173, lon: 11.560496 }],
    ]);
    expect(sections[2].to).toEqual({
      name: "München Flughafen Terminal",
      stationId: "8004168",
      position: { lat: 48.353732, lon: 11.785973 },
    });
  });

  it("reads each vehicle's category code from the KCC block, walks left out", () => {
    const sections = parseHinfahrtRecon(ALEX_RECON)!;
    expect(sections.map((s) => [s.kind, s.categoryCode])).toEqual([
      ["vehicle", "DRB"],
      ["walk", null],
      ["vehicle", "DBS"],
    ]);
  });

  it("names no category rather than a shifted one when the block does not fit", () => {
    expect(reconCategoryCodes(ALEX_RECON, 3)).toBeNull();
    expect(reconCategoryCodes(ALEX_RECON.replace("¶KCC¶", "¶KCX¶"), 2)).toBeNull();
    expect(reconCategoryCodes(ALEX_RECON.replace("¶KCC¶I1ZF", "¶KCC¶!!!!"), 2)).toBeNull();
  });

  it.each([
    ["no X", "@X=10885568@Y=48365444@L=8000013", "@Y=48365444@L=8000013"],
    ["a latitude off the graticule", "@Y=48365444@L=8000013", "@Y=98365444@L=8000013"],
    ["a longitude off the graticule", "@X=10885568@", "@X=190885568@"],
    ["text in place of digits", "@X=10885568@", "@X=10.885568@"],
    ["0/0, an empty field", "@X=10885568@Y=48365444@", "@X=0@Y=0@"],
  ])("states no position for %s, and still reads the ride", (_label, from, to) => {
    const sections = parseHinfahrtRecon(ALEX_RECON.replace(from, to));
    expect(sections).not.toBeNull();
    expect(sections![0].from.position).toBeNull();
  });

  it("hands every stop and the leg's mode on to the booking", () => {
    const booking = bookingFromConnection(connectionFromAnswer(ALEX_ANSWER)!, null)!;
    expect(booking.legs).toHaveLength(2);
    expect(booking.legs[0]).toMatchObject({
      depStationName: "Augsburg Hbf",
      trainCategory: null,
      trainNumber: "57031",
      departureStop: { eva: "8000013", position: { lat: 48.365444, lon: 10.885568 } },
      arrivalStop: { eva: "8000261", position: { lat: 48.140229, lon: 11.558339 } },
      transit: { mode: "rail", busKind: null },
    });
    expect(booking.legs[1]).toMatchObject({
      depStationName: "München Hbf (tief)",
      departureStop: { eva: "8098263" },
      arrivalStop: { eva: "8004168", position: { lat: 48.353732, lon: 11.785973 } },
      transit: { mode: "rail", busKind: null },
    });
  });

  it("classifies a tram the recon names STR, even printed as a bare number", () => {
    const kcc = Buffer.from("Z#VN#1#CA#STR#ZB#  12#\nZ#VN#1#CA#ubu#ZB#U3#\n").toString("base64");
    const recon =
      "¶HKI¶" +
      "T$A=1@O=Teststadt Rathaus@X=11000000@Y=48000000@L=9900001@$A=1@O=Teststadt Markt@L=9900002@" +
      "$202611030808$202611030820$  12$$1$$$$$$§" +
      "T$A=1@O=Teststadt Markt@L=9900002@$A=1@O=Teststadt Nord@L=9900003@" +
      "$202611030825$202611030835$U3$$1$$$$$$" +
      `¶KCC¶${kcc}¶`;
    const booking = bookingFromConnection(connectionFromAnswer({ hinfahrtRecon: recon })!, null)!;
    expect(booking.legs.map((l) => l.transit?.mode)).toEqual(["tram", "metro"]);
  });

  it("reads a web-client section's EVA numbers and product group", () => {
    const answer = {
      verbindungsAbschnitte: [
        {
          abfahrtsOrt: "Teststadt Rathaus",
          ankunftsOrt: "Teststadt Markt",
          abfahrtsZeitpunkt: "2026-11-03T08:08:00",
          ankunftsZeitpunkt: "2026-11-03T08:20:00",
          abfahrtsOrtExtId: "9900001",
          ankunftsOrtExtId: "not-an-eva",
          verkehrsmittel: { name: "Bus 100", produktGattung: "BUS" },
        },
      ],
    };
    const booking = bookingFromConnection(connectionFromAnswer(answer)!, null)!;
    expect(booking.legs[0]).toMatchObject({
      departureStop: { eva: "9900001", position: null },
      arrivalStop: { eva: null, position: null },
      transit: { mode: "bus", busKind: "city" },
    });
  });
});
