jest.mock("../wikidataVessel", () => ({
  searchWikidataByName: jest.fn(),
  searchWikidataByImo: jest.fn(),
}));
jest.mock("../../ferry/aisStream", () => ({
  ...jest.requireActual("../../ferry/aisStream"),
  collectStaticData: jest.fn(),
}));
import { prisma } from "../../../db";
import { collectStaticData } from "../../ferry/aisStream";
import { searchWikidataByImo, searchWikidataByName, type WikidataVessel } from "../wikidataVessel";
import {
  isOfferedCandidate,
  pickAisStatic,
  pickWikidata,
  resolveVessel,
  searchVesselCandidates,
} from "../vesselResolver";
import { normaliseVesselName } from "../vesselName";

const ship = (over: Partial<WikidataVessel>): WikidataVessel => ({
  qid: "Q1",
  name: "Stena Germanica",
  names: ["Stena Germanica"],
  mmsi: "265177000",
  imo: "9145176",
  operators: ["Stena Line"],
  ...over,
});

const USER = "00000000-0000-4000-8000-0000000000aa";

beforeEach(async () => {
  jest.mocked(searchWikidataByName).mockReset();
  jest.mocked(searchWikidataByImo).mockReset();
  jest.mocked(collectStaticData).mockReset();
  await prisma.vesselIdentity.deleteMany({});
});
afterAll(async () => {
  await prisma.vesselIdentity.deleteMany({});
});

describe("normaliseVesselName", () => {
  it("drops the prefix, case, diacritics and a Wikidata disambiguation", () => {
    expect(normaliseVesselName("MS Stena Germanica")).toBe("stena germanica");
    expect(normaliseVesselName("M/S Finnmaid")).toBe("finnmaid");
    expect(normaliseVesselName("Peter Pan (ship, 2001)")).toBe("peter pan");
    expect(normaliseVesselName("Nordlys")).toBe("nordlys");
  });
});

describe("pickWikidata", () => {
  it("picks the one ship whose name is the vessel's", () => {
    const r = pickWikidata(
      [ship({}), ship({ qid: "Q2", names: ["Stena Germanica II"], mmsi: "1" })],
      {
        name: "MS Stena Germanica",
        operator: null,
      }
    );
    expect(r).toMatchObject({ status: "resolved", mmsi: "265177000", confidence: "medium" });
  });

  it("abstains on two ships of the same name and offers both as candidates", () => {
    const r = pickWikidata(
      [ship({ operators: [] }), ship({ qid: "Q2", mmsi: "219000000", operators: [] })],
      { name: "Stena Germanica", operator: null }
    );
    expect(r).toMatchObject({ status: "unresolved", reason: "ambiguous" });
    expect(r.status === "unresolved" && r.candidates.map((c) => c.mmsi)).toEqual([
      "265177000",
      "219000000",
    ]);
  });

  it("abstains when a second ship of the name exists without an MMSI on Wikidata", () => {
    // Measured 2026-11-22: "MS Roald Amundsen" (Hurtigruten) resolved to a German brig,
    // the only same-named item that carried P587.
    const brig = ship({
      qid: "Q10",
      name: "Roald Amundsen",
      names: ["Roald Amundsen"],
      mmsi: "211215170",
      imo: null,
      operators: [],
    });
    const expedition = ship({
      qid: "Q11",
      name: "Roald Amundsen",
      names: ["MS Roald Amundsen"],
      mmsi: null,
      imo: "9813072",
      operators: [],
    });
    expect(
      pickWikidata([brig, expedition], { name: "MS Roald Amundsen", operator: null })
    ).toMatchObject({ status: "unresolved", reason: "ambiguous" });
  });

  it("abstains when the one ship of the name belongs to another operator", () => {
    expect(
      pickWikidata([ship({ operators: ["Scandlines"] })], {
        name: "Stena Germanica",
        operator: "Hurtigruten",
      })
    ).toMatchObject({ status: "unresolved" });
  });

  it("lets the operator decide between two ships of the same name", () => {
    const r = pickWikidata(
      [ship({}), ship({ qid: "Q2", mmsi: "219000000", operators: ["Scandlines"] })],
      { name: "Stena Germanica", operator: "Stena Line Scandinavia AB" }
    );
    expect(r).toMatchObject({ status: "resolved", mmsi: "265177000", confidence: "high" });
  });

  it("by IMO takes exactly one MMSI, high", () => {
    expect(pickWikidata([ship({})], { name: null, operator: null, imo: "9145176" })).toMatchObject({
      status: "resolved",
      confidence: "high",
    });
  });
});

describe("pickAisStatic", () => {
  it("picks the single transmitting ship of that name, abstains on two", () => {
    const one = pickAisStatic([{ mmsi: "211000001", name: "FINNMAID", imo: null }], {
      name: "Finnmaid",
    });
    expect(one).toMatchObject({ status: "resolved", source: "aisstream", mmsi: "211000001" });
    const two = pickAisStatic(
      [
        { mmsi: "211000001", name: "FINNMAID", imo: null },
        { mmsi: "211000002", name: "FINNMAID", imo: null },
      ],
      { name: "Finnmaid" }
    );
    expect(two).toMatchObject({ status: "unresolved", reason: "ambiguous" });
  });
});

describe("resolveVessel", () => {
  it("prefers the catalogue's own MMSI and asks nobody", async () => {
    const row = await prisma.ship.create({
      data: {
        name: "Resolver Test Ship",
        cruiseLine: "Test Line",
        mmsi: "247000123",
        imo: "9999991",
      },
    });
    try {
      const r = await resolveVessel({ name: "x", operator: null, shipId: row.id, userId: USER });
      expect(r).toMatchObject({ status: "resolved", source: "catalogue", mmsi: "247000123" });
      expect(searchWikidataByName).not.toHaveBeenCalled();
    } finally {
      await prisma.ship.delete({ where: { id: row.id } });
    }
  });

  it("caches an answer with its source, and an ambiguity as one: no second lookup", async () => {
    jest.mocked(searchWikidataByName).mockResolvedValue({
      ok: true,
      vessels: [ship({ operators: [] }), ship({ qid: "Q2", mmsi: "219000000", operators: [] })],
    });
    const q = { name: "Stena Germanica", operator: null, userId: USER, area: null };
    expect(await resolveVessel(q)).toMatchObject({ status: "unresolved", reason: "ambiguous" });
    expect(await resolveVessel(q)).toMatchObject({ status: "unresolved", reason: "ambiguous" });
    expect(searchWikidataByName).toHaveBeenCalledTimes(1);
    const row = await prisma.vesselIdentity.findFirstOrThrow({});
    expect(row).toMatchObject({ mmsi: null, reason: "ambiguous" });
    // The candidates it offered are what a manual pick may choose from.
    expect(await isOfferedCandidate("219000000", [row.lookupKey])).toMatchObject({
      mmsi: "219000000",
    });
    expect(await isOfferedCandidate("219999999", [row.lookupKey])).toBeNull();
  });

  it("falls back to AIS static data when Wikidata has no such ship", async () => {
    jest.mocked(searchWikidataByName).mockResolvedValue({ ok: true, vessels: [] });
    jest.mocked(collectStaticData).mockResolvedValue({
      status: "ok",
      vessels: [{ mmsi: "257000001", name: "KYSTFERJE", imo: null }],
    });
    const area = { minLat: 59, maxLat: 61, minLon: 4, maxLon: 6 };
    // Without an AIS key the step never runs; with one (the mock) it does.
    const { setInstanceTuning, resetInstanceTuning } = await import("../../instanceTuning");
    setInstanceTuning({ aisstreamApiKey: "k" });
    try {
      expect(
        await resolveVessel({ name: "Kystferje", operator: null, userId: USER, area })
      ).toMatchObject({ status: "resolved", source: "aisstream", confidence: "medium" });
    } finally {
      resetInstanceTuning();
    }
  });

  it("says unavailable, not 'not found', when Wikidata does not answer — and a page load caches no miss", async () => {
    jest.mocked(searchWikidataByName).mockResolvedValue({ ok: false, failure: "timeout" });
    const r = await resolveVessel({ name: "Some Ferry", operator: null, userId: USER, ais: false });
    expect(r).toMatchObject({ status: "unresolved", reason: "unavailable" });
    expect(await prisma.vesselIdentity.count()).toBe(0);
  });

  it("searchVesselCandidates offers only ships with an MMSI and remembers the list", async () => {
    jest.mocked(searchWikidataByName).mockResolvedValue({ ok: true, vessels: [ship({})] });
    const r = await searchVesselCandidates("Stena", USER);
    expect(r).toEqual({
      status: "ok",
      candidates: [expect.objectContaining({ mmsi: "265177000", source: "wikidata" })],
    });
    expect(await isOfferedCandidate("265177000", ["search:stena"])).not.toBeNull();
  });
});
