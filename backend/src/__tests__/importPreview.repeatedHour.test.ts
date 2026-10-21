/**
 * The autumn hour in a tracker import.
 *
 * On 2024-10-27 Berlin's clocks showed 02:00–02:59 twice (CEST, then CET) and
 * London's 01:00–01:59. AirTrail exports instants and App in the Air exports
 * both the UTC and the local clock, so either file says which of the two a
 * flight meant. The parsers used to keep only the wall clock, and the preview
 * placed it at the earlier occurrence — a flight that left at the second 02:30
 * was stored an hour early, its duration an hour long.
 */
import { buildPreviewRows } from "../services/importPreview";
import { parseAirTrail } from "../services/parsers/trackers/airtrail";
import { parseAppInTheAir } from "../services/parsers/trackers/appInTheAir";
import { prisma } from "../db";

function airTrail(departure: string, arrival: string): string {
  return JSON.stringify({
    flights: [
      {
        date: departure.slice(0, 10),
        from: { iata: "BER", icao: "EDDB", tz: "Europe/Berlin" },
        to: { iata: "LHR", icao: "EGLL", tz: "Europe/London" },
        departure,
        arrival,
        duration: (Date.parse(arrival) - Date.parse(departure)) / 1000,
        flightNumber: "BA983",
      },
    ],
  });
}

describe("importPreview — the repeated autumn hour", () => {
  let userId: string;
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: "test-import-fold-" + Date.now(), passwordHash: "x" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("keeps an AirTrail departure in the second 02:30 at its own instant", async () => {
    const parsed = parseAirTrail(airTrail("2024-10-27T01:30:00.000Z", "2024-10-27T02:45:00.000Z"));
    const [row] = (await buildPreviewRows(userId, parsed.rows)).rows;
    expect(row.flags).toEqual([]);
    expect(row.departureLocal).toBe("2024-10-27T02:30:00");
    expect(row.depUtc.toISOString()).toBe("2024-10-27T01:30:00.000Z");
    expect(row.departureFold).toBe("later");
    expect(row.arrUtc.toISOString()).toBe("2024-10-27T02:45:00.000Z");
    expect(row.arrivalFold).toBeUndefined();
  });

  it("keeps an AirTrail arrival in the second 01:30 at its own instant", async () => {
    const parsed = parseAirTrail(airTrail("2024-10-27T00:00:00.000Z", "2024-10-27T01:30:00.000Z"));
    const [row] = (await buildPreviewRows(userId, parsed.rows)).rows;
    expect(row.flags).toEqual([]);
    expect(row.departureFold).toBeUndefined();
    expect(row.arrivalLocalCorrected).toBe("2024-10-27T01:30:00");
    expect(row.arrUtc.toISOString()).toBe("2024-10-27T01:30:00.000Z");
    expect(row.arrivalFold).toBe("later");
  });

  it("leaves the first occurrence where it was", async () => {
    const parsed = parseAirTrail(airTrail("2024-10-27T00:30:00.000Z", "2024-10-27T02:45:00.000Z"));
    const [row] = (await buildPreviewRows(userId, parsed.rows)).rows;
    expect(row.depUtc.toISOString()).toBe("2024-10-27T00:30:00.000Z");
    expect(row.departureFold).toBeUndefined();
  });

  it("keeps an App in the Air departure in the second 02:30 at its UTC instant", async () => {
    const text = [
      "trips:",
      "Ownership.MINE;2024-10-27T01:30:00;2024-10-27T02:45:00;BER;LHR;2024-01-01T00:00:00;2024-01-02T00:00:00;None",
      "flights:",
      "ECONOMY;12A;SYN555;None;None;None;search;BA;983;320;BER;LHR;" +
        "2024-10-27T01:30:00;2024-10-27T02:45:00;2024-10-27T02:30:00;2024-10-27T02:45:00;2024-01-01T00:00:00",
      "hotels:",
      "",
    ].join("\n");
    const parsed = parseAppInTheAir(text);
    expect(parsed.parserErrors).toEqual([]);
    const [row] = (await buildPreviewRows(userId, parsed.rows)).rows;
    expect(row.flags).toEqual([]);
    expect(row.depUtc.toISOString()).toBe("2024-10-27T01:30:00.000Z");
    expect(row.departureFold).toBe("later");
    expect(row.arrUtc.toISOString()).toBe("2024-10-27T02:45:00.000Z");
  });
});
