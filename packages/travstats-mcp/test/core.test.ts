import { describe, it, expect } from "vitest";
import { redact } from "../src/core/redact";
import { loadConfig } from "../src/core/config";
import { createClient } from "../src/core/client";
import { callTool, preflight, versionAtLeast, TOOLS } from "../src/core/runtime";
import { capOutput } from "../src/core/output";
import type { ApiClient } from "../src/core/client";

const TOKEN = `ts_pat_${"a1".repeat(32)}`;
const cfg = {
  apiBase: "http://x/api/v1",
  token: TOKEN,
  clientBudgetPerMinute: 100,
  timeoutMs: 1000,
};
const stub = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  createClient(
    cfg,
    (async () => new Response(JSON.stringify(body), { status, headers })) as typeof fetch,
    async () => undefined
  );
const tool = (n: string) => TOOLS.find((t) => t.name === n)!;
const fake = (routes: Record<string, unknown>): ApiClient =>
  ({ get: async (p: string) => routes[p] }) as ApiClient;

describe("redact", () => {
  it("removes anything shaped like a token and the configured token", () => {
    expect(redact(`Bearer ${TOKEN} and ts_pat_deadbeef01`, TOKEN)).not.toMatch(
      /ts_pat_[0-9a-f]{8}/
    );
    expect(redact("secret-value-123456", "secret-value-123456")).toBe("[redacted]");
  });
});

describe("loadConfig", () => {
  it("needs a URL and a token shaped like a TravStats token", () => {
    expect(() => loadConfig({})).toThrow(/TRAVSTATS_URL/);
    expect(() => loadConfig({ TRAVSTATS_URL: "ftp://x", TRAVSTATS_TOKEN: TOKEN })).toThrow(/http/);
    expect(() => loadConfig({ TRAVSTATS_URL: "http://x", TRAVSTATS_TOKEN: "nope" })).toThrow(
      /ts_pat_/
    );
    expect(
      loadConfig({ TRAVSTATS_URL: "https://t.example/", TRAVSTATS_TOKEN: TOKEN }).apiBase
    ).toBe("https://t.example/api/v1");
  });
});

describe("version gate", () => {
  it("orders release candidates below their release", () => {
    expect(versionAtLeast("2.8.0-rc.45", "2.8.0-rc.45")).toBe(true);
    expect(versionAtLeast("2.8.0-rc.44", "2.8.0-rc.45")).toBe(false);
    expect(versionAtLeast("2.8.0", "2.8.0-rc.45")).toBe(true);
    expect(versionAtLeast("2.8.0-rc.9", "2.8.0-rc.45")).toBe(false);
    expect(versionAtLeast("2.7.9", "2.8.0-rc.45")).toBe(false);
    expect(versionAtLeast("3.0.0-rc.1", "2.8.0-rc.45")).toBe(true);
  });
});

describe("preflight", () => {
  const v = { version: "2.8.0-rc.45" };
  it("refuses admin and fails closed on an unknown scope", async () => {
    await expect(
      preflight(fake({ "/auth/me": { tokenScope: "admin" }, "/version": v }))
    ).rejects.toThrow(/admin/);
    await expect(
      preflight(fake({ "/auth/me": { tokenScope: "root" }, "/version": v }))
    ).rejects.toThrow(/unknown scope/);
    await expect(
      preflight(fake({ "/auth/me": { tokenScope: null }, "/version": v }))
    ).rejects.toThrow(/unknown scope/);
  });
  it("starts read-only with a warning on a server older than the scope report", async () => {
    const out = await preflight(
      fake({ "/auth/me": { user: {} }, "/version": { version: "2.8.0-rc.44" } })
    );
    expect(out.scope).toBeNull();
    expect(out.warning).toMatch(/cannot check that it is not an admin/);
  });
  it("a current server that omits the scope fails closed (no warning path)", async () => {
    await expect(preflight(fake({ "/auth/me": { user: {} }, "/version": v }))).rejects.toThrow(
      /unknown scope/
    );
  });
  it("an old server that DOES report admin is still refused", async () => {
    await expect(
      preflight(
        fake({ "/auth/me": { tokenScope: "admin" }, "/version": { version: "2.8.0-rc.44" } })
      )
    ).rejects.toThrow(/admin/);
  });
});

describe("failures map to their own reason", () => {
  it.each([
    [401, "auth"],
    [403, "scope"],
    [404, "not_found"],
    [429, "rate_limited"],
    [500, "server"],
    [504, "timeout"],
  ])("HTTP %i is %s", async (status, reason) => {
    const out = await callTool(
      { client: stub(status, { error: "x" }), instance: "http://x" },
      tool("get_readiness"),
      {},
      TOKEN
    );
    expect(out.text).toMatch(new RegExp(`^\\[${reason}\\]`));
  });

  it("a redirect is not followed", async () => {
    const out = await callTool(
      { client: stub(302, {}, { location: "http://evil/" }), instance: "http://x" },
      tool("get_readiness"),
      {},
      TOKEN
    );
    expect(out.isError).toBe(true);
    expect(out.text).not.toContain("evil");
  });

  it("never prints the token even when the server echoes it", async () => {
    const echo = createClient(
      cfg,
      (async (_u: unknown, init: RequestInit) =>
        new Response(
          JSON.stringify({ error: String((init.headers as Record<string, string>).Authorization) }),
          { status: 500 }
        )) as typeof fetch
    );
    const out = await callTool(
      { client: echo, instance: "http://x" },
      tool("get_readiness"),
      {},
      TOKEN
    );
    expect(out.text).not.toContain(TOKEN);
    expect(out.text).not.toMatch(/ts_pat_[0-9a-f]{8}/);
  });

  it("a network error is unreachable", async () => {
    const down = createClient(cfg, (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch);
    const out = await callTool(
      { client: down, instance: "http://x" },
      tool("get_readiness"),
      {},
      TOKEN
    );
    expect(out.text).toMatch(/^\[unreachable\]/);
  });

  it("the client budget stops a loop before the server", async () => {
    const c = createClient(
      { ...cfg, clientBudgetPerMinute: 1 },
      (async () => new Response("{}")) as typeof fetch
    );
    const ctx = { client: c, instance: "http://x" };
    await callTool(ctx, tool("get_readiness"), {});
    expect((await callTool(ctx, tool("get_readiness"), {})).text).toMatch(/^\[rate_limited\]/);
  });
});

describe("tools", () => {
  it("rejects unknown arguments before any call", async () => {
    const out = await callTool({ client: fake({}), instance: "http://x" }, tool("get_readiness"), {
      surprise: 1,
    });
    expect(out.text).toMatch(/^\[invalid_input\]/);
  });

  it("keeps a server null as null (abstention is not zero)", async () => {
    const out = await callTool(
      {
        client: fake({
          "/stats/summary": { totalCost: null, totalFlights: 0 },
          "/purpose/visibility": { data: { visibility: {} } },
        }),
        instance: "http://x",
      },
      tool("get_stats"),
      { view: "summary", onlyRecorded: true }
    );
    expect((out.structured!.figures as { totalCost: unknown }).totalCost).toBeNull();
    expect(out.structured!.onlyRecorded).toBe(true);
  });

  it("returns no raw TravTrack points", async () => {
    const day = {
      date: "2026-01-15",
      zone: "UTC",
      segments: [[[1]]],
      pointIds: [["p"]],
      pointDetails: [[{ lat: 1 }]],
      legs: [],
      stops: [],
      context: [],
      coverage: [],
      pointCount: 1,
      truncated: false,
      omitted: {},
    };
    const out = await callTool(
      { client: fake({ "/travtrack/day": day }), instance: "http://x" },
      tool("get_travtrack_day"),
      { date: "2026-01-15" }
    );
    expect(Object.keys(out.structured!)).not.toEqual(expect.arrayContaining(["segments"]));
    expect(out.text).not.toContain("pointDetails");
  });

  it("only GET routes exist", () => {
    expect(TOOLS.every((t) => t.wraps.every((w) => w.method === "GET"))).toBe(true);
  });
});

describe("capOutput", () => {
  it("cuts the longest list and says so", () => {
    const out = capOutput(
      { instance: "x", rows: Array.from({ length: 50 }, () => "y".repeat(1000)) },
      5000
    );
    expect(out.truncated).toBe(true);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(5000);
  });
});
