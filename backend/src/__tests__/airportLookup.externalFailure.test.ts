import { prisma } from "../db";
import {
  lookupOrCreateAirport,
  missCacheSizeForTests,
  resetAirportLookupCaches,
} from "../services/airportLookup";

const CSV = [
  "id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,continent,iso_country,iso_region,municipality,scheduled_service,gps_code,iata_code,local_code",
  '1,ZZTA,small_airport,"Test, Field",10.5,20.5,100,EU,DE,DE-BE,Testville,no,ZZTA,ZTA,',
].join("\n");

const emptyApi = () => new Response(JSON.stringify({}), { status: 200 });

describe("airport lookup against failing external sources (forgejo#347)", () => {
  const realFetch = global.fetch;

  beforeEach(async () => {
    resetAirportLookupCaches();
    await prisma.airport.deleteMany({ where: { OR: [{ iata: "ZTA" }, { icao: "ZZTA" }] } });
  });
  afterEach(() => {
    global.fetch = realFetch;
  });
  afterAll(async () => {
    await prisma.airport.deleteMany({ where: { OR: [{ iata: "ZTA" }, { icao: "ZZTA" }] } });
    await prisma.$disconnect();
  });

  it("passes an abort signal to every outbound request, so a hung host cannot hang the lookup", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
      signals.push(init?.signal);
      return String(url).includes("airport-data") ? emptyApi() : new Response(CSV);
    }) as unknown as typeof fetch;
    await lookupOrCreateAirport("QQQ");
    expect(signals).toHaveLength(2);
    expect(signals.every((s) => s instanceof AbortSignal)).toBe(true);
  });

  it("reports a timeout as unavailable/timeout, not as a silent null", async () => {
    global.fetch = jest.fn(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    }) as unknown as typeof fetch;
    await expect(lookupOrCreateAirport("QQQ")).resolves.toEqual({
      status: "unavailable",
      reason: "timeout",
    });
  });

  it("does not remember a failure as a miss", async () => {
    const fn = jest.fn(async () => {
      throw new Error("down");
    });
    global.fetch = fn as unknown as typeof fetch;
    await lookupOrCreateAirport("QQQ");
    const callsAfterFirst = fn.mock.calls.length;
    await lookupOrCreateAirport("QQQ");
    expect(fn.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("remembers a real miss so a repeated unknown code makes no further requests", async () => {
    const fn = jest.fn(async (url: unknown) =>
      String(url).includes("airport-data") ? emptyApi() : new Response(CSV)
    );
    global.fetch = fn as unknown as typeof fetch;
    expect(await lookupOrCreateAirport("QQQ")).toEqual({ status: "not_found" });
    const calls = fn.mock.calls.length;
    expect(await lookupOrCreateAirport("QQQ")).toEqual({ status: "not_found" });
    expect(fn.mock.calls.length).toBe(calls);
  });

  it("downloads and parses the CSV once for concurrent misses of different codes", async () => {
    const fn = jest.fn(async (url: unknown) =>
      String(url).includes("airport-data") ? emptyApi() : new Response(CSV)
    );
    global.fetch = fn as unknown as typeof fetch;
    const results = await Promise.all([
      lookupOrCreateAirport("QQ1"),
      lookupOrCreateAirport("QQ2"),
      lookupOrCreateAirport("QQ3"),
    ]);
    expect(results.every((r) => r.status === "not_found")).toBe(true);
    const csvCalls = fn.mock.calls.filter(([u]) => String(u).includes("ourairports"));
    expect(csvCalls).toHaveLength(1);
  });

  it("finds a code through the parsed index, quoted comma in the name included", async () => {
    global.fetch = jest.fn(async (url: unknown) =>
      String(url).includes("airport-data") ? emptyApi() : new Response(CSV)
    ) as unknown as typeof fetch;
    const result = await lookupOrCreateAirport("ZTA");
    expect(result.status).toBe("found");
    if (result.status === "found") expect(result.airport.name).toBe("Test, Field");
  });

  it("answers a malformed code as not found with no upstream call and no cache entry", async () => {
    const fn = jest.fn(async () => emptyApi());
    global.fetch = fn as unknown as typeof fetch;
    for (const bad of ["", "A", "TOOLONG", "ab cd", "../etc", "É12", "x".repeat(5000)]) {
      expect(await lookupOrCreateAirport(bad)).toEqual({ status: "not_found" });
    }
    expect(fn).not.toHaveBeenCalled();
    expect(missCacheSizeForTests()).toBe(0);
  });

  it("bounds the miss cache however many distinct codes miss", async () => {
    global.fetch = jest.fn(async (url: unknown) =>
      String(url).includes("airport-data") ? emptyApi() : new Response(CSV)
    ) as unknown as typeof fetch;
    const codes: string[] = [];
    for (let i = 0; i < 1100; i++) codes.push(`Q${i.toString(36).toUpperCase().padStart(3, "0")}`);
    for (const c of codes) await lookupOrCreateAirport(c);
    expect(missCacheSizeForTests()).toBeLessThanOrEqual(1000);
    expect(missCacheSizeForTests()).toBeGreaterThan(900);
  }, 60_000);
});
