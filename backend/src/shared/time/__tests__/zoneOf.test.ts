import { execFileSync } from "child_process";
import path from "path";

/**
 * The zone lookup every local time in the app is interpreted through.
 *
 * Acceptance 2026-09-26: under `npm run dev` (tsx) every lookup threw
 * "find is not a function" — tsx honoured a tsconfig `paths` entry that
 * pointed `geo-tz/all` at a `.d.ts` — and a try/catch turned the throw into
 * "no zone", so a rail journey typed as 09:13 Berlin was stored as 09:13Z.
 * Jest (ts-jest ignores `paths`) and the compiled server both loaded the real
 * module, so no test saw it. The first test below runs the lookup THROUGH
 * TSX, the loader that broke.
 */

const BACKEND_ROOT = path.resolve(__dirname, "../../../..");

describe("zoneOf under the loaders that run it", () => {
  it("answers a known coordinate when loaded through tsx (npm run dev)", () => {
    const script =
      'const g = require("./src/shared/time/zoneOf");' +
      "process.stdout.write(JSON.stringify({ zone: g.zoneOf({ lat: 52.52, lon: 13.405 }), check: g.runZoneSelfCheck() }));" +
      "process.exit(0);";
    const out = execFileSync(
      process.execPath,
      [path.join(BACKEND_ROOT, "node_modules/tsx/dist/cli.mjs"), "-e", script],
      { cwd: BACKEND_ROOT, encoding: "utf8", env: { ...process.env, LOG_LEVEL: "silent" } }
    );
    const line = out.trim().split("\n").pop() ?? "";
    expect(JSON.parse(line)).toEqual({ zone: "Europe/Berlin", check: { ok: true } });
  }, 60_000);
});

describe("zoneOf when the lookup is broken", () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock("geo-tz/dist/find-all");
  });

  function loadWithBrokenFind(): typeof import("../zoneOf") {
    jest.resetModules();
    jest.doMock("geo-tz/dist/find-all", () => ({ find: undefined }));
    return require("../zoneOf") as typeof import("../zoneOf");
  }

  it("throws a coded error instead of answering 'no zone'", () => {
    const { zoneOf } = loadWithBrokenFind();
    expect(() => zoneOf({ lat: 41.39, lon: 2.17 })).toThrow(
      expect.objectContaining({ statusCode: 503, code: "TIMEZONE_LOOKUP_UNAVAILABLE" })
    );
  });

  it("still abstains without an error on coordinates that are not a place", () => {
    const { zoneOf } = loadWithBrokenFind();
    expect(zoneOf({ lat: null, lon: null })).toBeNull();
    expect(zoneOf({ lat: 999, lon: 999 })).toBeNull();
    // A catalogue zone answers without the coordinate path at all.
    expect(zoneOf({ catalogueZone: "Europe/Vienna", lat: 48.2, lon: 16.37 })).toBe("Europe/Vienna");
  });

  it("marks the boot self-check failed, and /health degraded", () => {
    const geo = loadWithBrokenFind();
    expect(geo.runZoneSelfCheck()).toEqual({ ok: false, reason: expect.any(String) });

    const { healthHandler } =
      require("../../../routes/health") as typeof import("../../../routes/health");
    const json = jest.fn();
    healthHandler({} as never, { json } as never);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ status: "degraded", checks: { timezoneLookup: "failed" } })
    );
  });
});

describe("zoneOf with the real dataset", () => {
  it("prefers a catalogue zone Intl knows, and ignores one it does not", () => {
    const { zoneOf } = require("../zoneOf") as typeof import("../zoneOf");
    expect(zoneOf({ catalogueZone: "Asia/Kolkata", lat: 52.52, lon: 13.405 })).toBe("Asia/Kolkata");
    expect(zoneOf({ catalogueZone: "Mars/Olympus", lat: 52.52, lon: 13.405 })).toBe(
      "Europe/Berlin"
    );
  });

  it("names the full-dataset zone, not the folded one (CAMP-03)", () => {
    const { zoneOf, runZoneSelfCheck } = require("../zoneOf") as typeof import("../zoneOf");
    expect(zoneOf({ lat: 13.69, lon: 100.75 })).toBe("Asia/Bangkok");
    expect(runZoneSelfCheck()).toEqual({ ok: true });
  });
});

describe("resolveZone — the strict form", () => {
  it("names where the zone came from", () => {
    const { resolveZone } = require("../zoneOf") as typeof import("../zoneOf");
    expect(resolveZone({ catalogueZone: "Asia/Kolkata", lat: 52.52, lon: 13.405 })).toEqual({
      zone: "Asia/Kolkata",
      source: "catalogue",
    });
    expect(resolveZone({ lat: 52.52, lon: 13.405 })).toEqual({
      zone: "Europe/Berlin",
      source: "coordinates",
    });
  });

  it("refuses a place with no zone as 422 TZ_UNRESOLVED — never UTC", () => {
    const { resolveZone, zoneOf } = require("../zoneOf") as typeof import("../zoneOf");
    for (const place of [{}, { lat: 999, lon: 0 }, { catalogueZone: "+02:00" }]) {
      expect(() => resolveZone(place)).toThrow(
        expect.objectContaining({ statusCode: 422, code: "TZ_UNRESOLVED" })
      );
      expect(zoneOf(place)).toBeNull();
    }
  });
});
