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

const BACKEND_ROOT = path.resolve(__dirname, "../../..");

describe("geoTimezone under the loaders that run it", () => {
  it("answers a known coordinate when loaded through tsx (npm run dev)", () => {
    const script =
      'const g = require("./src/utils/geoTimezone");' +
      "process.stdout.write(JSON.stringify({ zone: g.zoneAt(52.52, 13.405), check: g.runTimezoneSelfCheck() }));" +
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

describe("geoTimezone when the lookup is broken", () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock("geo-tz/dist/find-all");
  });

  function loadWithBrokenFind(): typeof import("../geoTimezone") {
    jest.resetModules();
    jest.doMock("geo-tz/dist/find-all", () => ({ find: undefined }));
    return require("../geoTimezone") as typeof import("../geoTimezone");
  }

  it("throws a coded error instead of answering 'no zone'", () => {
    const { zoneAt } = loadWithBrokenFind();
    expect(() => zoneAt(41.39, 2.17)).toThrow(
      expect.objectContaining({ statusCode: 503, code: "TIMEZONE_LOOKUP_UNAVAILABLE" })
    );
  });

  it("still abstains without an error on coordinates that are not a place", () => {
    const { zoneAt } = loadWithBrokenFind();
    expect(zoneAt(null, null)).toBeNull();
    expect(zoneAt(999, 999)).toBeNull();
  });

  it("marks the boot self-check failed, and /health degraded", () => {
    const geo = loadWithBrokenFind();
    expect(geo.runTimezoneSelfCheck()).toEqual({ ok: false, reason: expect.any(String) });

    const { healthHandler } =
      require("../../routes/health") as typeof import("../../routes/health");
    const json = jest.fn();
    healthHandler({} as never, { json } as never);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ status: "degraded", checks: { timezoneLookup: "failed" } })
    );
  });
});

describe("geoTimezone with the real dataset", () => {
  it("names the full-dataset zone, not the folded one (CAMP-03)", () => {
    const { zoneAt, runTimezoneSelfCheck } =
      require("../geoTimezone") as typeof import("../geoTimezone");
    expect(zoneAt(13.69, 100.75)).toBe("Asia/Bangkok");
    expect(runTimezoneSelfCheck()).toEqual({ ok: true });
  });
});
