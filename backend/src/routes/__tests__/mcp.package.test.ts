import http from "node:http";
import type { AddressInfo } from "node:net";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateApiToken } from "../../utils/apiTokens";
import { createClient } from "../../../../packages/travstats-mcp/src/core/client";
import { loadConfig } from "../../../../packages/travstats-mcp/src/core/config";
import { callTool, preflight, TOOLS } from "../../../../packages/travstats-mcp/src/core/runtime";
import type { ToolDef } from "../../../../packages/travstats-mcp/src/core/types";

/**
 * travstats-mcp's tools against the real app (own database): what a user's assistant would see.
 * The contract test (mcp.contract.test.ts) holds the routes and fields; this holds the meaning.
 */
const USERNAME = "mcpPackageUser";
const OTHER = "mcpPackageStranger";

async function pat(userId: string, scope: "read" | "write" | "admin"): Promise<string> {
  const t = await generateApiToken();
  await prisma.apiToken.create({
    data: { userId, label: `mcp-${scope}`, lookupHash: t.lookupHash, hash: t.hash, scope },
  });
  return t.plaintext;
}

const tool = (name: string): ToolDef => TOOLS.find((t) => t.name === name)!;

describe("travstats-mcp against the real API", () => {
  let server: http.Server;
  let url: string;
  let userId: string;
  let readToken: string;
  let ctx: { client: ReturnType<typeof createClient>; instance: string };
  const trips: string[] = [];

  const clientFor = (token: string, budget = 1000) => {
    const config = loadConfig({
      TRAVSTATS_URL: url,
      TRAVSTATS_TOKEN: token,
      TRAVSTATS_MCP_CALLS_PER_MINUTE: String(budget),
    });
    return { config, client: createClient(config) };
  };
  const call = (name: string, args: unknown, token = readToken) =>
    callTool(ctx, tool(name), args, token);

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: [USERNAME, OTHER] } } });
    userId = (
      await prisma.user.create({
        data: {
          username: USERNAME,
          passwordHash: await hashPassword("password123"),
          isAdmin: true,
        },
      })
    ).id;
    const stranger = await prisma.user.create({
      data: { username: OTHER, passwordHash: await hashPassword("password123") },
    });
    for (let i = 1; i <= 3; i++) {
      const t = await prisma.trip.create({
        data: { userId, name: `Zanzibar tour ${i}`, status: "completed" },
      });
      trips.push(t.id);
    }
    await prisma.trip.create({
      data: { userId: stranger.id, name: "Zanzibar secret of someone else" },
    });
    readToken = await pat(userId, "read");
    server = http.createServer(app).listen(0);
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    ctx = { client: clientFor(readToken).client, instance: clientFor(readToken).config.instance };
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    await prisma.user.deleteMany({ where: { username: { in: [USERNAME, OTHER] } } });
  });

  describe("start-up gate", () => {
    it("accepts a read token and reports its scope", async () => {
      expect((await preflight(ctx.client)).scope).toBe("read");
    });

    it("refuses an admin token", async () => {
      const admin = await pat(userId, "admin");
      await expect(preflight(clientFor(admin).client)).rejects.toThrow(/admin/);
    });

    it("fails closed on a scope it does not know", async () => {
      const odd = {
        get: async (p: string) =>
          p === "/auth/me" ? { tokenScope: "superuser" } : { version: "9.9.9" },
      };
      await expect(preflight(odd as never)).rejects.toThrow(/did not report/);
    });

    it("fails closed when the server does not report a scope at all (older server)", async () => {
      const old = {
        get: async (p: string) => (p === "/auth/me" ? { user: {} } : { version: "9.9.9" }),
      };
      await expect(preflight(old as never)).rejects.toThrow(/did not report/);
    });
  });

  describe("tools", () => {
    it("search_entries finds the user's trip, with a link, and never another account's", async () => {
      const out = await call("search_entries", { q: "Zanzibar", domains: ["trip"] });
      expect(out.isError).toBe(false);
      const hits = out.structured!.hits as Array<{ title: string; link: string }>;
      expect(hits.map((h) => h.title).sort()).toEqual([
        "Zanzibar tour 1",
        "Zanzibar tour 2",
        "Zanzibar tour 3",
      ]);
      expect(hits[0].link.startsWith(url)).toBe(true);
      expect(out.text).not.toContain("someone else");
    });

    it("list_trips pages with a cursor and reaches every trip exactly once", async () => {
      const first = await call("list_trips", { q: "Zanzibar", limit: 2 });
      const s1 = first.structured as {
        trips: Array<{ id: string }>;
        nextCursor: string | null;
        total: number;
      };
      expect(s1.trips).toHaveLength(2);
      expect(s1.total).toBe(3);
      expect(s1.nextCursor).toBeTruthy();
      const second = await call("list_trips", { q: "Zanzibar", limit: 2, cursor: s1.nextCursor });
      const s2 = second.structured as { trips: Array<{ id: string }>; nextCursor: string | null };
      expect(s2.trips).toHaveLength(1);
      expect(s2.nextCursor).toBeNull();
      expect([...s1.trips, ...s2.trips].map((t) => t.id).sort()).toEqual([...trips].sort());
    });

    it("list_trips rejects a cursor it did not hand out", async () => {
      const out = await call("list_trips", { cursor: "bogus" });
      expect(out.isError).toBe(true);
      expect(out.text).toMatch(/^\[invalid_input\]/);
    });

    it("get_trip_summary returns the trip's own record, and not_found for a stranger's trip", async () => {
      const ok = await call("get_trip_summary", { tripId: trips[0] });
      expect((ok.structured!.trip as { name: string }).name).toBe("Zanzibar tour 1");
      const strangerTrip = await prisma.trip.findFirstOrThrow({
        where: { name: { contains: "someone else" } },
      });
      const no = await call("get_trip_summary", { tripId: strangerTrip.id });
      expect(no.isError).toBe(true);
      expect(no.text).toMatch(/^\[not_found\]/);
    });

    it("get_stats passes onlyRecorded through, echoes it, and keeps the server's null as null", async () => {
      const out = await call("get_stats", { view: "summary", onlyRecorded: true });
      const s = out.structured as {
        onlyRecorded: boolean;
        figures: { totalCost: number | null; totalFlights: number };
        purposeVisibility: unknown;
      };
      expect(s.onlyRecorded).toBe(true);
      expect(s.figures.totalFlights).toBe(0);
      expect(s.figures.totalCost).toBeNull(); // no priced flight: abstention, not 0
      expect(s.purposeVisibility).toBeDefined();
    });

    it("get_stats timeseries and countries answer", async () => {
      expect((await call("get_stats", { view: "countries" })).isError).toBe(false);
      expect(
        (
          await call("get_stats", {
            view: "timeseries",
            domain: "flight",
            granularity: "year",
            window: "all",
          })
        ).isError
      ).toBe(false);
    });

    it("get_travtrack_day returns a summary and no raw points", async () => {
      const day = {
        date: "2026-01-15",
        zone: "Europe/Berlin",
        segments: [[[1, 52.5, 13.4]]],
        pointIds: [["p1"]],
        pointDetails: [[{ lat: 52.5, lon: 13.4 }]],
        legs: [
          {
            id: "l1",
            fromMs: 1_000,
            untilMs: 2_000,
            mode: "train",
            distanceM: 1200,
            durationMs: 1000,
            bounds: [1, 2, 3, 4],
            ranges: [{ segment: 0, from: 0, to: 1 }],
            entryRef: null,
          },
        ],
        stops: [
          {
            fromMs: 0,
            untilMs: 1_000,
            anchor: { lat: 52.5, lon: 13.4 },
            place: { name: "Hotel", lat: 52.5, lon: 13.4, source: "lodging" },
          },
        ],
        context: [],
        coverage: [{ fromMs: 0, untilMs: 2_000, state: "recorded" }],
        pointCount: 1,
        truncated: false,
        omitted: { privacyZone: 0, implausible: 0 },
      };
      const out = await callTool(
        { client: { get: async () => day } as never, instance: url },
        tool("get_travtrack_day"),
        { date: "2026-01-15" },
        readToken
      );
      expect(out.isError).toBe(false);
      for (const raw of ["segments", "pointIds", "pointDetails"])
        expect(Object.keys(out.structured!)).not.toContain(raw);
      expect(out.text).not.toContain("52.5");
      expect(out.structured!.stays).toEqual([
        expect.objectContaining({ place: { name: "Hotel", source: "lodging" } }),
      ]);
      expect(out.structured!.moves).toEqual([
        expect.objectContaining({ mode: "train", distanceM: 1200 }),
      ]);
    });

    it("get_travtrack_day says `disabled` when the server has TravTrack switched off", async () => {
      const out = await call("get_travtrack_day", { date: "2026-01-15" });
      expect(out.text).toMatch(/^\[disabled\]/);
    });

    it("get_travtrack_day refuses a malformed date before calling the server", async () => {
      const out = await call("get_travtrack_day", { date: "15.01.2026" });
      expect(out.text).toMatch(/^\[invalid_input\]/);
    });

    it("get_upcoming, get_readiness and list_inbox answer for an empty account", async () => {
      expect((await call("get_upcoming", {})).structured!.total).toBe(0);
      expect((await call("get_readiness", {})).isError).toBe(false);
      const inbox = (await call("list_inbox", {})).structured as {
        errors: unknown[];
        items: unknown[];
      };
      expect(inbox.errors).toEqual([]);
      expect(inbox.items).toEqual([]);
    });

    it("list_inbox reports a failing source as that source's error instead of dropping it", async () => {
      const flaky = {
        get: async (path: string, q?: Record<string, string>) => {
          if (path === "/data-quality-flags") {
            const { ToolFailure } =
              await import("../../../../packages/travstats-mcp/src/core/errors");
            throw new ToolFailure("server", "boom");
          }
          return ctx.client.get(path, q);
        },
      };
      const out = await callTool(
        { client: flaky as never, instance: url },
        tool("list_inbox"),
        {},
        readToken
      );
      const errors = out.structured!.errors as Array<{ kind: string; reason: string }>;
      expect(errors).toEqual([expect.objectContaining({ kind: "data_quality", reason: "server" })]);
      expect(out.text).toContain("data_quality");
    });

    it("get_routing_run says not_found for an unknown run", async () => {
      const out = await call("get_routing_run", { runId: "00000000-0000-0000-0000-000000000000" });
      expect(out.text).toMatch(/^\[not_found\]/);
    });

    it("caps the output and says so", async () => {
      const big = {
        get: async () => ({
          data: {
            hits: Array.from({ length: 25 }, (_, i) => ({
              domain: "trip",
              id: String(i),
              title: "x".repeat(2000),
              path: "/trips/1",
            })),
            more: [],
            failed: [],
            capped: false,
          },
        }),
      };
      const out = await callTool(
        { client: big as never, instance: url },
        tool("search_entries"),
        { q: "x" },
        readToken
      );
      expect(out.structured!.truncated).toBe(true);
      expect(JSON.stringify(out.structured).length).toBeLessThan(20_100);
    });
  });

  describe("failures arrive as themselves", () => {
    it("wrong token is auth", async () => {
      const bad = clientFor(`ts_pat_${"0".repeat(64)}`);
      const out = await callTool(
        { client: bad.client, instance: bad.config.instance },
        tool("get_readiness"),
        {}
      );
      expect(out.text).toMatch(/^\[auth\]/);
    });

    it("a closed port is unreachable", async () => {
      const dead = loadConfig({ TRAVSTATS_URL: "http://127.0.0.1:1", TRAVSTATS_TOKEN: readToken });
      const out = await callTool(
        { client: createClient(dead), instance: dead.instance },
        tool("get_readiness"),
        {}
      );
      expect(out.text).toMatch(/^\[unreachable\]/);
    });

    it("the client budget stops a looping agent before the server does", async () => {
      const tight = clientFor(readToken, 2);
      const c = { client: tight.client, instance: tight.config.instance };
      await callTool(c, tool("get_readiness"), {});
      await callTool(c, tool("get_readiness"), {});
      const third = await callTool(c, tool("get_readiness"), {});
      expect(third.text).toMatch(/^\[rate_limited\].*retry after/);
    });

    const stub = (status: number, body: unknown, headers: Record<string, string> = {}) =>
      createClient(
        {
          apiBase: "http://x/api/v1",
          token: readToken,
          clientBudgetPerMinute: 100,
          timeoutMs: 1000,
        },
        (async () => new Response(JSON.stringify(body), { status, headers })) as typeof fetch,
        async () => undefined
      );

    it.each([
      [403, "scope"],
      [404, "not_found"],
      [429, "rate_limited"],
      [500, "server"],
      [504, "timeout"],
    ])("HTTP %i maps to %s", async (status, reason) => {
      const out = await callTool(
        { client: stub(status, { error: "nope" }, { "retry-after": "30" }), instance: "http://x" },
        tool("get_readiness"),
        {}
      );
      expect(out.isError).toBe(true);
      expect(out.text).toMatch(new RegExp(`^\\[${reason}\\]`));
    });

    it("a redirect is not followed and is reported, not trusted", async () => {
      const out = await callTool(
        { client: stub(302, {}, { location: "http://evil.example/" }), instance: "http://x" },
        tool("get_readiness"),
        {}
      );
      expect(out.isError).toBe(true);
      expect(out.text).not.toContain("evil.example");
    });

    it("never prints the token, even when the server echoes the Authorization header", async () => {
      const echo = createClient(
        {
          apiBase: "http://x/api/v1",
          token: readToken,
          clientBudgetPerMinute: 100,
          timeoutMs: 1000,
        },
        (async (_u: unknown, init: RequestInit) =>
          new Response(
            JSON.stringify({
              error: `bad header ${(init.headers as Record<string, string>).Authorization}`,
            }),
            { status: 500 }
          )) as typeof fetch
      );
      const out = await callTool(
        { client: echo, instance: "http://x" },
        tool("get_readiness"),
        {},
        readToken
      );
      expect(out.text).not.toContain(readToken);
      expect(out.text).not.toMatch(/ts_pat_[0-9a-f]{8}/);
    });
  });

  it("a read token cannot be made to write: the package has no write tool and the server refuses one", () => {
    expect(TOOLS.every((t) => t.wraps.every((w) => w.method === "GET"))).toBe(true);
  });
});
