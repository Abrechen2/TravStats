import { settleArrivalDate } from "../legs";

const zones: Record<string, string> = {
  ORD: "America/Chicago",
  MUC: "Europe/Berlin",
  NRT: "Asia/Tokyo",
  HNL: "Pacific/Honolulu",
  MAD: "Europe/Madrid",
  LIS: "Europe/Lisbon",
};
const zoneOf = async (code: string) => zones[code] ?? null;

describe("settleArrivalDate — the arrival day from both airports' zones", () => {
  it("keeps the next-day arrival of an overnight eastbound flight", async () => {
    const leg = {
      departureCode: "ORD",
      arrivalCode: "MUC",
      departureTime: "2016-01-08T17:50",
      arrivalTime: "2016-01-09T09:50",
      missing: [],
    };
    expect((await settleArrivalDate(leg, zoneOf)).arrivalTime).toBe("2016-01-09T09:50");
  });

  it("puts a short westbound hop with an earlier local clock on the same day", async () => {
    // MAD 10:00 → LIS 09:55 local is a 1 h 55 min flight, not 24 hours.
    const leg = {
      departureCode: "MAD",
      arrivalCode: "LIS",
      departureTime: "2026-03-01T10:00",
      arrivalTime: "2026-03-02T09:55",
      missing: [],
    };
    expect((await settleArrivalDate(leg, zoneOf)).arrivalTime).toBe("2026-03-01T09:55");
  });

  it("keeps a dateline crossing whose local arrival clock is earlier", async () => {
    const leg = {
      departureCode: "NRT",
      arrivalCode: "HNL",
      departureTime: "2026-03-01T21:00",
      arrivalTime: "2026-03-01T09:00",
      missing: [],
    };
    expect((await settleArrivalDate(leg, zoneOf)).arrivalTime).toBe("2026-03-01T09:00");
  });

  it("leaves the reading alone when a zone is unknown", async () => {
    const leg = {
      departureCode: "XXX",
      arrivalCode: "LIS",
      departureTime: "2026-03-01T10:00",
      arrivalTime: "2026-03-02T09:55",
      missing: [],
    };
    expect((await settleArrivalDate(leg, zoneOf)).arrivalTime).toBe("2026-03-02T09:55");
  });
});
