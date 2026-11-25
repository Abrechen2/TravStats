import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import { createClient } from "../src/core/client";
import type { ApiClient } from "../src/core/client";
import { DraftStore } from "../src/core/drafts";
import { loadFile } from "../src/core/files";
import { UNTRUSTED_NOTE, availableTools, callTool, scrubArgs } from "../src/core/runtime";
import { WRITE_TOOLS, resetJobBudget } from "../src/core/writeTools";
import type { ToolContext, ToolDef } from "../src/core/types";

const TOKEN = `ts_pat_${"a1".repeat(32)}`;
const tool = (n: string): ToolDef => WRITE_TOOLS.find((t) => t.name === n)!;

interface Call {
  kind: "get" | "post" | "postForm";
  path: string;
  body?: unknown;
  fields?: Record<string, string | undefined>;
}

/** A client that records every call and answers from a table keyed by "METHOD path". */
function recorder(answers: Record<string, unknown | (() => unknown)>) {
  const calls: Call[] = [];
  const answer = (key: string) => {
    const a = answers[key];
    if (a === undefined) throw new Error(`unexpected call ${key}`);
    return typeof a === "function" ? (a as () => unknown)() : a;
  };
  const client = {
    get: async (p: string) => (calls.push({ kind: "get", path: p }), answer(`GET ${p}`)),
    post: async (p: string, body: unknown) => (
      calls.push({ kind: "post", path: p, body }),
      answer(`POST ${p}`)
    ),
    postForm: async (p: string, _f: unknown, fields: Call["fields"]) => (
      calls.push({ kind: "postForm", path: p, fields }),
      answer(`POST ${p}`)
    ),
  } as unknown as ApiClient;
  return { client, calls };
}

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n");
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mcp-files-"));
  resetJobBudget();
});

const ctxOf = (client: ApiClient, extra: Partial<ToolContext> = {}): ToolContext => ({
  client,
  instance: "https://trav.example",
  filesDir: dir,
  drafts: new DraftStore(),
  ...extra,
});

const AIRPORT = (iata: string, lat: number, lon: number, tz = "Europe/Berlin") => ({
  iata,
  icao: `E${iata}`,
  name: `${iata} Airport`,
  lat,
  lon,
  timezone: tz,
});

describe("files folder", () => {
  it("refuses a name that climbs out of the folder", async () => {
    writeFileSync(path.join(dir, "..", "outside.pdf"), PDF);
    await expect(loadFile(dir, "../outside.pdf")).rejects.toThrow(/inside the files directory/);
  });

  it("refuses a symlink that leaves the folder, and a symlinked folder component", async () => {
    const other = mkdtempSync(path.join(tmpdir(), "mcp-other-"));
    writeFileSync(path.join(other, "secret.pdf"), PDF);
    symlinkSync(path.join(other, "secret.pdf"), path.join(dir, "link.pdf"));
    mkdirSync(path.join(dir, "sub"));
    symlinkSync(other, path.join(dir, "sub", "out"));
    await expect(loadFile(dir, "link.pdf")).rejects.toThrow(/outside the files directory/);
    await expect(loadFile(dir, "sub/out/secret.pdf")).rejects.toThrow(
      /outside the files directory/
    );
  });

  it("judges by the bytes: a .pdf that is not a PDF is refused, a real one is read", async () => {
    writeFileSync(path.join(dir, "fake.pdf"), "MZ\u0000\u0000 not a pdf");
    writeFileSync(path.join(dir, "real.pdf"), PDF);
    await expect(loadFile(dir, "fake.pdf")).rejects.toThrow(/not a PDF/);
    expect((await loadFile(dir, "real.pdf")).kind).toBe("pdf");
  });

  it("reads JPEG, PNG and an .eml, and refuses a text file with an unknown name", async () => {
    writeFileSync(path.join(dir, "a.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]));
    writeFileSync(
      path.join(dir, "b.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])
    );
    writeFileSync(path.join(dir, "c.eml"), "From: a@b\nSubject: x\n\nbody");
    writeFileSync(path.join(dir, "d.dat"), "plain text");
    expect((await loadFile(dir, "a.jpg")).kind).toBe("image");
    expect((await loadFile(dir, "b.png")).kind).toBe("image");
    expect((await loadFile(dir, "c.eml")).kind).toBe("eml");
    await expect(loadFile(dir, "d.dat")).rejects.toThrow(/not a PDF/);
  });

  it("refuses a file over the size limit and a directory, and is off without a folder", async () => {
    writeFileSync(path.join(dir, "big.eml"), Buffer.alloc(3 * 1024 * 1024, 65));
    mkdirSync(path.join(dir, "d.pdf"));
    await expect(loadFile(dir, "big.eml")).rejects.toThrow(/at most 2 MB/);
    await expect(loadFile(dir, "d.pdf")).rejects.toThrow(/regular file|opened/);
    await expect(loadFile(null, "x.pdf")).rejects.toThrow(/File tools are off/);
  });
});

describe("what a session offers", () => {
  it("offers write tools only for a write token, and file tools only with a folder", () => {
    const names = (scope: "read" | "write" | null, d: string | null) =>
      availableTools(scope, d).map((t) => t.name);
    expect(names("read", dir).some((n) => n === "add_flight")).toBe(false);
    expect(names(null, dir).some((n) => n === "parse_booking")).toBe(false);
    expect(names("write", null)).toContain("parse_booking");
    expect(names("write", null)).not.toContain("upload_document");
    expect(names("write", null)).not.toContain("parse_boarding_pass");
    expect(names("write", dir)).toContain("upload_document");
  });

  it("states that every write tool writes, and offers no delete, merge, sharing, settings or token tool", () => {
    for (const t of WRITE_TOOLS.filter(
      (x) =>
        x.name.startsWith("add_") ||
        ["resolve_inbox_item", "reroute_trip_legs", "upload_document"].includes(x.name)
    ))
      expect(t.description).toMatch(/WRITES/);
    expect(WRITE_TOOLS.map((t) => t.name).join(" ")).not.toMatch(
      /delete|merge|share|setting|token|admin/i
    );
  });
});

describe("confirm", () => {
  const AIR = {
    "GET /airports/FRA": AIRPORT("FRA", 50.03, 8.57),
    "GET /airports/JFK": AIRPORT("JFK", 40.64, -73.78, "America/New_York"),
  };
  const flight = {
    domain: "flight" as const,
    flightNumber: "LH400",
    departureAirport: "FRA",
    arrivalAirport: "JFK",
    departureLocal: "2031-07-06T10:00",
    arrivalLocal: "2031-07-06T12:40",
  };

  const cases: Array<[string, Record<string, unknown>]> = [
    ["add_flight", { entry: flight }],
    ["add_entry_from_draft", { entry: flight }],
    ["add_place_visit", { place: { name: "Café", lat: 1, lon: 2 }, date: "2031-07-06" }],
    ["resolve_inbox_item", { kind: "pending_update", id: "x", action: "apply" }],
    ["reroute_trip_legs", { routeId: "r1" }],
    ["upload_document", { fileName: "real.pdf" }],
  ];
  for (const [name, args] of cases) {
    it(`${name} refuses to write without confirm: true and says what it would send`, async () => {
      writeFileSync(path.join(dir, "real.pdf"), PDF);
      const { client, calls } = recorder(AIR);
      const out = await callTool(ctxOf(client), tool(name), args, TOKEN);
      expect(out.isError).toBe(false);
      expect(out.structured).toMatchObject({ written: false, confirmRequired: true });
      expect(out.structured?.wouldSend).toBeDefined();
      expect(calls.filter((c) => c.kind !== "get")).toEqual([]);
    });
  }

  it("a model that sends confirm as the string 'true' is refused by validation, not treated as yes", async () => {
    const { client, calls } = recorder(AIR);
    const out = await callTool(
      ctxOf(client),
      tool("add_flight"),
      { entry: flight, confirm: "true" },
      TOKEN
    );
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/^\[invalid_input\]/);
    expect(calls).toEqual([]);
  });
});

describe("parse_booking", () => {
  it("saves nothing: it only asks the parse route and keeps the draft in memory", async () => {
    const { client, calls } = recorder({
      "POST /parse-email": {
        domain: "flight",
        flights: [
          {
            airline: "LH",
            flightNumber: "LH400",
            departureCode: "FRA",
            arrivalCode: "JFK",
            departureTime: "2031-07-06T10:00",
            arrivalTime: "2031-07-06T12:40",
            missing: [],
          },
        ],
        text: "ignored echo",
      },
    });
    const out = await callTool(
      ctxOf(client),
      tool("parse_booking"),
      { text: "Ihre Buchung LH400" },
      TOKEN
    );
    expect(out.isError).toBe(false);
    expect(out.structured).toMatchObject({
      savedNothing: true,
      domain: "flight",
      hasOriginal: true,
    });
    expect(calls.map((c) => `${c.kind} ${c.path}`)).toEqual(["post /parse-email"]);
    expect(out.structured?.untrusted).toBe(UNTRUSTED_NOTE);
  });

  it("routes a PDF, an image and an .eml to their own parse routes, only from the folder", async () => {
    writeFileSync(path.join(dir, "t.pdf"), PDF);
    writeFileSync(path.join(dir, "p.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9]));
    writeFileSync(path.join(dir, "m.eml"), "From: a@b\nSubject: s\n\nb");
    const { client, calls } = recorder({
      "POST /parse-pdf": { domain: "rail", bookings: [{ legs: [] }] },
      "POST /parse-image": { domain: "lodging", candidates: [{}] },
      "POST /parse-email-file": { domain: "cruise", cruises: [{ input: {} }] },
    });
    for (const f of ["t.pdf", "p.jpg", "m.eml"])
      expect(
        (await callTool(ctxOf(client), tool("parse_booking"), { fileName: f }, TOKEN)).isError
      ).toBe(false);
    expect(calls.map((c) => c.path)).toEqual(["/parse-pdf", "/parse-image", "/parse-email-file"]);
    const out = await callTool(
      ctxOf(client),
      tool("parse_booking"),
      { fileName: "../etc/passwd" },
      TOKEN
    );
    expect(out.isError).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it("needs exactly one of text and fileName, and caps the text at 20 kB", async () => {
    const { client } = recorder({});
    const both = await callTool(
      ctxOf(client),
      tool("parse_booking"),
      { text: "a", fileName: "b.pdf" },
      TOKEN
    );
    const none = await callTool(ctxOf(client), tool("parse_booking"), {}, TOKEN);
    const big = await callTool(
      ctxOf(client),
      tool("parse_booking"),
      { text: "ü".repeat(11_000) },
      TOKEN
    );
    for (const o of [both, none, big]) expect(o.text).toMatch(/^\[invalid_input\]/);
  });

  it("names the server's AI parser and a detected domain in the warnings", async () => {
    const { client } = recorder({
      "POST /parse-email": {
        domain: "rail",
        domainSource: "detected",
        detection: { candidates: [] },
        bookings: [{ legs: [] }],
        llmProvider: { host: "api.example" },
        fallbackReason: "noItinerary",
      },
    });
    const out = await callTool(ctxOf(client), tool("parse_booking"), { text: "x" }, TOKEN);
    const warnings = (out.structured?.warnings as string[]).join(" | ");
    expect(warnings).toMatch(/language model/);
    expect(warnings).toMatch(/picked the domain itself/);
    expect(warnings).toMatch(/noItinerary/);
  });
});

describe("add_entry_from_draft", () => {
  const flightBody = {
    domain: "flight",
    flights: [
      {
        airline: "Lufthansa",
        flightNumber: "LH400",
        departureCode: "FRA",
        arrivalCode: "JFK",
        departureTime: "2031-07-06T10:00:00",
        arrivalTime: "2031-07-06T12:40:00",
        pnr: "ABC123",
        seatClass: "Economy Light",
        missing: [],
      },
    ],
  };
  const AIR = {
    "GET /airports/FRA": AIRPORT("FRA", 50.03, 8.57),
    "GET /airports/JFK": AIRPORT("JFK", 40.64, -73.78, "America/New_York"),
  };

  async function draftOf(ctx: ToolContext, answers: Record<string, unknown>) {
    const out = await callTool(
      ctx,
      tool("parse_booking"),
      { text: "LH400 confirmation text" },
      TOKEN
    );
    expect(answers).toBeDefined();
    return out.structured!.draftId as string;
  }

  it("files the ORIGINAL first and creates the entry carrying it; the answer names both", async () => {
    const { client, calls } = recorder({
      "POST /parse-email": flightBody,
      ...AIR,
      "POST /documents": { success: true, data: { id: "11111111-1111-4111-8111-111111111111" } },
      "POST /flights": { flight: { id: "22222222-2222-4222-8222-222222222222" } },
    });
    const ctx = ctxOf(client);
    const draftId = await draftOf(ctx, {});
    const out = await callTool(
      ctx,
      tool("add_entry_from_draft"),
      { draftId, confirm: true },
      TOKEN
    );
    expect(out.isError).toBe(false);
    expect(out.structured).toMatchObject({
      written: true,
      id: "22222222-2222-4222-8222-222222222222",
      link: "https://trav.example/flights/22222222-2222-4222-8222-222222222222",
      documentId: "11111111-1111-4111-8111-111111111111",
      documentAttached: true,
    });
    const writes = calls.filter((c) => c.kind !== "get" && !c.path.startsWith("/parse"));
    expect(writes.map((c) => c.path)).toEqual(["/documents", "/flights"]);
    const body = writes[1].body as Record<string, unknown>;
    expect(body.documentIds).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(body).toMatchObject({
      departureLocal: "2031-07-06T10:00",
      depTimezone: "Europe/Berlin",
      arrTimezone: "America/New_York",
      seatClass: "economy",
      bookingReference: "ABC123",
      status: "scheduled",
    });
    expect(body.clientRef).toMatch(/^mcp-/);
    expect(writes[0].fields).toMatchObject({ kind: "booking" });
  });

  it("does not create the entry when the original cannot be filed", async () => {
    const { client, calls } = recorder({
      "POST /parse-email": flightBody,
      ...AIR,
      "POST /documents": () => {
        throw Object.assign(new Error("too big"), {});
      },
    });
    const ctx = ctxOf(client);
    const draftId = await draftOf(ctx, {});
    const out = await callTool(
      ctx,
      tool("add_entry_from_draft"),
      { draftId, confirm: true },
      TOKEN
    );
    expect(out.isError).toBe(true);
    expect(calls.some((c) => c.path === "/flights")).toBe(false);
  });

  it("says where the original stayed when the entry fails after the upload", async () => {
    const { ToolFailure } = await import("../src/core/errors");
    const { client } = recorder({
      "POST /parse-email": flightBody,
      ...AIR,
      "POST /documents": { success: true, data: { id: "11111111-1111-4111-8111-111111111111" } },
      "POST /flights": () => {
        throw new ToolFailure("server", "boom", { status: 500 });
      },
    });
    const ctx = ctxOf(client);
    const draftId = await draftOf(ctx, {});
    const out = await callTool(
      ctx,
      tool("add_entry_from_draft"),
      { draftId, confirm: true },
      TOKEN
    );
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/unfiled document \(11111111/);
  });

  it("refuses an airport without a time zone instead of guessing UTC", async () => {
    const { client, calls } = recorder({
      "POST /parse-email": flightBody,
      "GET /airports/FRA": { ...AIRPORT("FRA", 50, 8), timezone: null },
      "GET /airports/JFK": AIRPORT("JFK", 40, -73),
    });
    const ctx = ctxOf(client);
    const draftId = await draftOf(ctx, {});
    const out = await callTool(
      ctx,
      tool("add_entry_from_draft"),
      { draftId, confirm: true },
      TOKEN
    );
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/time zone/);
    expect(calls.some((c) => c.kind === "postForm")).toBe(false);
  });

  it("names what a draft lacks (a coach ticket has no coordinates) and completes from `entry`", async () => {
    const ticket = {
      domain: "bus",
      tickets: [
        {
          operator: "FlixBus",
          rides: [
            {
              depName: "Berlin ZOB",
              arrName: "Prag",
              departureLocal: "2031-05-01T08:00",
              arrivalLocal: "2031-05-01T13:00",
              lineName: "N1",
            },
          ],
        },
      ],
    };
    const { client, calls } = recorder({
      "POST /parse-email": ticket,
      "POST /documents": { success: true, data: { id: "33333333-3333-4333-8333-333333333333" } },
      "POST /bus": { data: { id: "44444444-4444-4444-8444-444444444444" } },
    });
    const ctx = ctxOf(client);
    const draftId = await draftOf(ctx, {});
    const lacking = await callTool(
      ctx,
      tool("add_entry_from_draft"),
      { draftId, confirm: true },
      TOKEN
    );
    expect(lacking.isError).toBe(true);
    expect(lacking.text).toMatch(
      /departureStation \{name, lat, lon\} \(the ticket prints "Berlin ZOB"\)/
    );
    const ok = await callTool(
      ctx,
      tool("add_entry_from_draft"),
      {
        draftId,
        confirm: true,
        entry: {
          domain: "bus",
          departureStation: { name: "Berlin ZOB", lat: 52.5, lon: 13.28 },
          arrivalStation: { name: "Praha Florenc", lat: 50.09, lon: 14.44 },
        },
      },
      TOKEN
    );
    expect(ok.isError).toBe(false);
    const post = calls.find((c) => c.path === "/bus")!;
    expect(post.body).toMatchObject({
      operator: "FlixBus",
      lineName: "N1",
      departureLocal: "2031-05-01T08:00",
      documentIds: ["33333333-3333-4333-8333-333333333333"],
    });
  });

  it("sends the booking's legs one by one, the original with the first, and reports a later failure as partial", async () => {
    const { ToolFailure } = await import("../src/core/errors");
    const st = (name: string, lat: number) => ({
      name,
      lat,
      lon: 9,
      resolved: true,
      stationId: 1,
      code: null,
      country: "DE",
    });
    let n = 0;
    const booking = {
      domain: "rail",
      bookings: [
        {
          bookingReference: "R1",
          price: 59,
          currency: "EUR",
          operator: "DB",
          travelClass: "second",
          source: "mail",
          legs: [
            {
              depStationName: "A",
              arrStationName: "B",
              departureLocal: "2031-05-01T08:00",
              arrivalLocal: "2031-05-01T09:00",
              trainCategory: "ICE",
              trainNumber: "1",
              duplicateOf: null,
              departureStation: st("A", 50),
              arrivalStation: st("B", 51),
            },
            {
              depStationName: "B",
              arrStationName: "C",
              departureLocal: "2031-05-01T09:10",
              arrivalLocal: "2031-05-01T10:00",
              duplicateOf: null,
              departureStation: st("B", 51),
              arrivalStation: st("C", 52),
            },
            {
              depStationName: "C",
              arrStationName: "D",
              departureLocal: "2031-05-01T10:10",
              duplicateOf: null,
              transit: { mode: "bus" },
              departureStation: st("C", 52),
              arrivalStation: st("D", 53),
            },
          ],
        },
      ],
    };
    const { client, calls } = recorder({
      "POST /parse-email": booking,
      "POST /documents": { success: true, data: { id: "55555555-5555-4555-8555-555555555555" } },
      "POST /rail": () => {
        if (++n === 2) throw new ToolFailure("server", "second leg refused", { status: 422 });
        return { data: { id: "66666666-6666-4666-8666-666666666666" } };
      },
    });
    const ctx = ctxOf(client);
    const draftId = await draftOf(ctx, {});
    const out = await callTool(
      ctx,
      tool("add_entry_from_draft"),
      { draftId, confirm: true },
      TOKEN
    );
    expect(out.isError).toBe(false);
    expect(out.structured).toMatchObject({ partial: true, documentAttached: true });
    expect((out.structured?.entries as unknown[]).length).toBe(1);
    expect(out.structured?.skipped).toEqual([expect.stringMatching(/bus ride/)]);
    const posts = calls.filter((c) => c.path === "/rail");
    expect((posts[0].body as Record<string, unknown>).documentIds).toBeDefined();
    expect((posts[0].body as Record<string, unknown>).price).toBe(59);
    expect((posts[1].body as Record<string, unknown>).documentIds).toBeUndefined();
    expect((posts[1].body as Record<string, unknown>).price).toBeUndefined();
  });

  it("writes no total on a booking whose leg is already logged (the ticket would count twice)", async () => {
    const st = {
      name: "A",
      lat: 50,
      lon: 9,
      resolved: true,
      stationId: 1,
      code: null,
      country: "DE",
    };
    const { client, calls } = recorder({
      "POST /parse-email": {
        domain: "rail",
        bookings: [
          {
            price: 40,
            currency: "EUR",
            source: "mail",
            legs: [
              {
                depStationName: "A",
                arrStationName: "B",
                departureLocal: "2031-05-01T08:00",
                duplicateOf: "logged",
                departureStation: st,
                arrivalStation: { ...st, name: "B" },
              },
              {
                depStationName: "B",
                arrStationName: "C",
                departureLocal: "2031-05-01T09:00",
                duplicateOf: null,
                departureStation: { ...st, name: "B" },
                arrivalStation: { ...st, name: "C" },
              },
            ],
          },
        ],
      },
      "POST /documents": { success: true, data: { id: "55555555-5555-4555-8555-555555555555" } },
      "POST /rail": { data: { id: "66666666-6666-4666-8666-666666666666" } },
    });
    const ctx = ctxOf(client);
    const draftId = await draftOf(ctx, {});
    await callTool(ctx, tool("add_entry_from_draft"), { draftId, confirm: true }, TOKEN);
    expect(
      (calls.find((c) => c.path === "/rail")!.body as Record<string, unknown>).price
    ).toBeUndefined();
  });

  it("adds a stay only through the server's own preview, filing the original with it", async () => {
    const stayItem = {
      lodging: { name: "Hotel Test", city: "Graz" },
      stay: { checkIn: "2031-10-01", checkOut: "2031-10-02" },
    };
    const { client, calls } = recorder({
      "POST /parse-email": { domain: "lodging", candidates: [stayItem] },
      "POST /lodging-import/preview": {
        data: { rows: [{ ...stayItem, action: "create", flags: [] }] },
      },
      "POST /documents": { success: true, data: { id: "11111111-1111-4111-8111-111111111111" } },
      "POST /lodging-import/commit": {
        data: { createdStayRefs: [{ stayId: "s-1", lodgingId: "l-1" }], documentFiled: true },
      },
    });
    const ctx = ctxOf(client);
    const draftId = await draftOf(ctx, {});
    const out = await callTool(
      ctx,
      tool("add_entry_from_draft"),
      { draftId, confirm: true },
      TOKEN
    );
    expect(out.isError).toBe(false);
    expect(out.structured).toMatchObject({
      id: "s-1",
      link: "https://trav.example/lodging/l-1",
      documentAttached: true,
    });
    const commit = calls.find((c) => c.path === "/lodging-import/commit")!.body as Record<
      string,
      unknown
    >;
    expect(commit.documentIds).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(commit.clientRef).toBeUndefined();
  });

  it("says so when the server did not file the original with the stay", async () => {
    const stayItem = {
      lodging: { name: "Hotel Test" },
      stay: { checkIn: "2031-10-01", checkOut: "2031-10-02" },
    };
    const { client } = recorder({
      "POST /parse-email": { domain: "lodging", candidates: [stayItem] },
      "POST /lodging-import/preview": {
        data: { rows: [{ ...stayItem, action: "create", flags: [] }] },
      },
      "POST /documents": { success: true, data: { id: "11111111-1111-4111-8111-111111111111" } },
      "POST /lodging-import/commit": {
        data: {
          createdStayRefs: [{ stayId: "s-1", lodgingId: "l-1" }],
          documentFiled: false,
          documentNotFiledReason: "link_failed",
        },
      },
    });
    const ctx = ctxOf(client);
    const draftId = await draftOf(ctx, {});
    const out = await callTool(
      ctx,
      tool("add_entry_from_draft"),
      { draftId, confirm: true },
      TOKEN
    );
    expect(out.structured?.documentAttached).toBe(false);
    expect((out.structured?.warnings as string[]).join(" ")).toMatch(/did not file the original/);
  });

  it("does not commit a stay the preview calls stored or in need of input, and writes no document", async () => {
    const stayItem = { lodging: { name: "Hotel Test" }, stay: null };
    for (const [action, text] of [
      ["skip", /already stored/],
      ["needs_input", /web import/],
    ] as const) {
      const { client, calls } = recorder({
        "POST /parse-email": { domain: "lodging", candidates: [stayItem] },
        "POST /lodging-import/preview": {
          data: { rows: [{ ...stayItem, action, flags: ["missing_name"] }] },
        },
      });
      const ctx = ctxOf(client);
      const draftId = await draftOf(ctx, {});
      const out = await callTool(
        ctx,
        tool("add_entry_from_draft"),
        { draftId, confirm: true },
        TOKEN
      );
      expect(out.isError).toBe(true);
      expect(out.text).toMatch(text);
      expect(calls.some((c) => c.kind === "postForm" || c.path === "/lodging-import/commit")).toBe(
        false
      );
    }
  });

  it("refuses a draft it never made", async () => {
    const { client } = recorder({});
    const out = await callTool(
      ctxOf(client),
      tool("add_entry_from_draft"),
      { draftId: "99999999-9999-4999-8999-999999999999", confirm: true },
      TOKEN
    );
    expect(out.text).toMatch(/^\[not_found\]/);
  });
});

describe("other write tools", () => {
  it("add_place_visit returns the new placeId as partial when the visit fails", async () => {
    const { ToolFailure } = await import("../src/core/errors");
    const { client } = recorder({
      "POST /places": { id: "77777777-7777-4777-8777-777777777777" },
      "POST /places/77777777-7777-4777-8777-777777777777/visits": () => {
        throw new ToolFailure("server", "no", { status: 500 });
      },
    });
    const out = await callTool(
      ctxOf(client),
      tool("add_place_visit"),
      { place: { name: "Café", lat: 1, lon: 2 }, date: "2031-07-06", confirm: true },
      TOKEN
    );
    expect(out.isError).toBe(false);
    expect(out.structured).toMatchObject({
      partial: true,
      placeId: "77777777-7777-4777-8777-777777777777",
    });
  });

  it("resolve_inbox_item answers with the kind's own vocabulary only, and sends the flag's revision", async () => {
    const { client, calls } = recorder({
      "GET /data-quality-flags": { flags: [{ id: "f1", revision: 4 }] },
      "POST /data-quality-flags/f1/dismiss": { success: true },
    });
    const wrong = await callTool(
      ctxOf(client),
      tool("resolve_inbox_item"),
      { kind: "pending_update", id: "x", action: "dismiss", confirm: true },
      TOKEN
    );
    expect(wrong.text).toMatch(/can only be answered with: apply, reject/);
    const ok = await callTool(
      ctxOf(client),
      tool("resolve_inbox_item"),
      { kind: "data_quality", id: "f1", action: "dismiss", confirm: true },
      TOKEN
    );
    expect(ok.isError).toBe(false);
    expect(calls.find((c) => c.path.endsWith("/dismiss"))?.body).toEqual({ revision: 4 });
  });

  it("reroute_trip_legs returns the run id when 30 s are not enough, and allows one start per minute", async () => {
    const { client } = recorder({
      "POST /tours/r1/reroute-all": {
        run: { id: "run-1", status: "running", processed: 1, total: 9 },
      },
      "GET /routing-runs/run-1": {
        run: { id: "run-1", status: "running", processed: 2, total: 9 },
      },
    });
    let slept = 0;
    const ctx = ctxOf(client, { sleep: async (ms) => void (slept += ms) });
    const out = await callTool(
      ctx,
      tool("reroute_trip_legs"),
      { routeId: "r1", confirm: true },
      TOKEN
    );
    expect(out.structured).toMatchObject({ runId: "run-1", finished: false });
    expect(slept).toBe(30_000);
    const again = await callTool(
      ctx,
      tool("reroute_trip_legs"),
      { routeId: "r1", confirm: true },
      TOKEN
    );
    expect(again.text).toMatch(/^\[rate_limited\]/);
  });

  it("upload_document files into the inbox unassigned, or onto a given entry", async () => {
    writeFileSync(path.join(dir, "inv.pdf"), PDF);
    const { client, calls } = recorder({
      "POST /documents": { success: true, data: { id: "88888888-8888-4888-8888-888888888888" } },
    });
    const loose = await callTool(
      ctxOf(client),
      tool("upload_document"),
      { fileName: "inv.pdf", confirm: true },
      TOKEN
    );
    expect(loose.structured).toMatchObject({
      documentId: "88888888-8888-4888-8888-888888888888",
      filed: false,
    });
    const entry = { type: "flight", id: "99999999-9999-4999-8999-999999999999" };
    await callTool(
      ctxOf(client),
      tool("upload_document"),
      { fileName: "inv.pdf", entry, confirm: true },
      TOKEN
    );
    expect(calls[0].fields?.entryType).toBeUndefined();
    expect(calls[1].fields).toMatchObject({ entryType: "flight", entryId: entry.id });
  });
});

describe("client headers and failures", () => {
  it("names itself and the tool on every call, and a read token's 403 comes back as `scope`", async () => {
    const seen: Array<Record<string, string>> = [];
    const client = createClient(
      { apiBase: "http://x/api/v1", token: TOKEN, clientBudgetPerMinute: 100, timeoutMs: 1000 },
      (async (_u: unknown, init: RequestInit) => {
        seen.push(init.headers as Record<string, string>);
        return new Response(JSON.stringify({ error: "A write token is required" }), {
          status: 403,
        });
      }) as typeof fetch,
      async () => undefined,
      "0.2.0"
    );
    const out = await callTool(
      ctxOf(client),
      tool("add_place_visit"),
      { placeId: "77777777-7777-4777-8777-777777777777", date: "2031-07-06", confirm: true },
      TOKEN
    );
    expect(out.text).toMatch(/^\[scope\]/);
    expect(seen[0]["X-TravStats-Client"]).toBe("travstats-mcp/0.2.0");
    expect(seen[0]["X-TravStats-Tool"]).toBe("add_place_visit");
  });
});

describe("audit", () => {
  it("is called per call with long free text reduced to its length, and never breaks a call", async () => {
    const entries: unknown[] = [];
    const { client } = recorder({ "POST /parse-email": { domain: "rail", bookings: [] } });
    const text = "secret booking text ".repeat(20);
    await callTool(
      ctxOf(client, { audit: (e) => entries.push(e) }),
      tool("parse_booking"),
      { text },
      TOKEN
    );
    expect(JSON.stringify(entries)).not.toContain("secret booking");
    expect(entries[0]).toMatchObject({
      tool: "parse_booking",
      status: "ok",
      args: { text: `[${text.length} chars]` },
    });
    const throwing = ctxOf(client, {
      audit: () => {
        throw new Error("disk full");
      },
    });
    expect((await callTool(throwing, tool("parse_booking"), { text: "x" }, TOKEN)).isError).toBe(
      false
    );
    expect(scrubArgs({ a: ["x".repeat(100)] })).toEqual({ a: ["[100 chars]"] });
  });
});
