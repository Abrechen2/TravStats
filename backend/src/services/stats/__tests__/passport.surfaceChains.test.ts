import { buildPassport, type PassportFlight } from "../passport";
import { railEnds, type RailEvidenceRide } from "../railEvidence";

/**
 * Owner ruling 2026-10-16 on forgejo#299: train and bus rides count like
 * flights. An outbound and a return ride to the same destination prove
 * "Land besucht"; a change station is ground presence only; an open or
 * undecidable chain is "unclear". Flights, trains and coaches form ONE
 * chain, so flying out and taking the train back closes a round trip too.
 */

const NOW = new Date("2026-10-16T12:00:00Z");
const AIRPORTS = new Map<string, string | null>([
  ["MUC", "DE"],
  ["FCO", "IT"],
]);

type Station = { name: string; country: string; tz: string };
const FRANKFURT: Station = { name: "Frankfurt (Main) Hbf", country: "DE", tz: "Europe/Berlin" };
const MUENCHEN: Station = { name: "München Hbf", country: "DE", tz: "Europe/Berlin" };
const BASEL: Station = { name: "Basel SBB", country: "CH", tz: "Europe/Zurich" };
const MILANO: Station = { name: "Milano Centrale", country: "IT", tz: "Europe/Rome" };
const ROMA: Station = { name: "Roma Termini", country: "IT", tz: "Europe/Rome" };
const PRAHA: Station = { name: "Praha Florenc", country: "CZ", tz: "Europe/Prague" };
const WIEN: Station = { name: "Wien Erdberg", country: "AT", tz: "Europe/Vienna" };

let seq = 0;
const ride = (from: Station, to: Station, departs: string, hours = 3): RailEvidenceRide => {
  const departureTime = new Date(departs);
  seq += 1;
  return {
    id: `r${seq}`,
    label: `${from.name} → ${to.name}`,
    depStationName: from.name,
    arrStationName: to.name,
    depCountry: from.country,
    arrCountry: to.country,
    depTimezone: from.tz,
    arrTimezone: to.tz,
    departureTime,
    arrivalTime: new Date(departureTime.getTime() + hours * 3_600_000),
  };
};

const flight = (dep: string, arr: string, day: string): PassportFlight => ({
  depIata: dep,
  arrIata: arr,
  depLat: 0,
  depLon: 0,
  arrLat: 0,
  arrLon: 0,
  departureTime: new Date(`${day}T08:00:00Z`),
  departureInstant: new Date(`${day}T08:00:00Z`),
  localDay: day,
  status: "flown",
});

const passport = (o: {
  flights?: PassportFlight[];
  rail?: RailEvidenceRide[];
  bus?: RailEvidenceRide[];
  home?: string[];
}) =>
  buildPassport(
    o.flights ?? [],
    AIRPORTS,
    [],
    NOW,
    [],
    [],
    [],
    undefined,
    [],
    [],
    railEnds(o.rail ?? []),
    "UTC",
    railEnds(o.bus ?? [], "bus"),
    o.home ?? []
  );

const row = (p: ReturnType<typeof buildPassport>, code: string) =>
  p.countries.find((c) => c.code === code);

describe("owner ruling 2026-10-16: rail and bus count like flights", () => {
  it("a rail round trip to Basel proves Switzerland visited", () => {
    const p = passport({
      rail: [
        ride(FRANKFURT, BASEL, "2025-03-01T07:00:00Z"),
        ride(BASEL, FRANKFURT, "2025-03-03T15:00:00Z"),
      ],
    });

    expect(row(p, "CH")).toMatchObject({
      groundPresence: true,
      visited: true,
      visitUncertain: false,
      visitSources: [{ domain: "rail", years: [2025], undated: false }],
    });
  });

  it("a bus round trip to Vienna proves Austria visited", () => {
    const p = passport({
      bus: [ride(PRAHA, WIEN, "2025-05-10T12:00:00Z"), ride(WIEN, PRAHA, "2025-05-12T08:00:00Z")],
    });

    expect(row(p, "AT")).toMatchObject({
      visited: true,
      visitSources: [{ domain: "bus", years: [2025], undated: false }],
    });
  });

  it("a change station on the way to the destination is ground presence only", () => {
    // Frankfurt -> Basel -> Milano and back the same way: Italy is the
    // turnaround, Switzerland only the change of trains, both ways.
    const p = passport({
      rail: [
        ride(FRANKFURT, BASEL, "2025-03-01T07:00:00Z"),
        ride(BASEL, MILANO, "2025-03-01T11:00:00Z"),
        ride(MILANO, BASEL, "2025-03-05T09:00:00Z"),
        ride(BASEL, FRANKFURT, "2025-03-05T14:00:00Z"),
      ],
    });

    expect(row(p, "IT")).toMatchObject({ visited: true });
    expect(row(p, "CH")).toMatchObject({
      groundPresence: true,
      visited: false,
      visitUncertain: false,
    });
  });

  it("a one-way ride leaves its destination unclear, not visited", () => {
    const p = passport({ rail: [ride(FRANKFURT, BASEL, "2025-03-01T07:00:00Z")] });

    expect(row(p, "CH")).toMatchObject({
      visited: false,
      visitUncertain: true,
      visitUncertainReasons: ["openChain"],
    });
  });

  it("flying out and taking the train back closes the round trip", () => {
    const p = passport({
      flights: [flight("MUC", "FCO", "2025-06-01")],
      rail: [ride(ROMA, MUENCHEN, "2025-06-08T08:00:00Z", 10)],
    });

    expect(row(p, "IT")).toMatchObject({
      visited: true,
      kinds: ["flight", "rail"],
      visitSources: [
        { domain: "flight", years: [2025], undated: false },
        { domain: "rail", years: [2025], undated: false },
      ],
    });
  });

  it("a home country reached by train is visited through the home rule", () => {
    const p = passport({
      rail: [ride(FRANKFURT, BASEL, "2025-03-01T07:00:00Z")],
      home: ["DE"],
    });

    expect(row(p, "DE")).toMatchObject({ visited: true, visitUncertain: false });
  });
});
