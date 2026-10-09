import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { TemplateRegistry } from "../registry";
import { DEFAULT_TEMPLATE_REPO_BASE_URL } from "../v2/source";
import { validTemplate } from "../v2/__tests__/fixtures";

/**
 * Plan 2026-10-09 P1: when the v2 index is absent or unreachable, the
 * registry does exactly what it did before v2 existed — the same v1 URLs,
 * the same airline templates. And a v2 index that IS there adds templates
 * without touching the airline path.
 */
const BASE = DEFAULT_TEMPLATE_REPO_BASE_URL;
const V1_INDEX = `${BASE}/templates/index.json`;
const V1_XX = `${BASE}/templates/XX.json`;
const V2_INDEX = `${BASE}/index.json`;

const airline = {
  airline: "Example Air",
  iata: "XX",
  version: "2026-01",
  from: ["example-air.test"],
  subject: ["Booking"],
  selectors: {},
  transforms: {},
  testCases: [],
};

const v1Routes: Record<string, unknown> = {
  [V1_INDEX]: { version: "2026-01", airlines: [{ iata: "XX", version: "2026-01" }] },
  [V1_XX]: airline,
};

function fakeFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const fn = (url: string): Promise<unknown> => {
    calls.push(url);
    return url in routes
      ? Promise.resolve(routes[url])
      : Promise.reject(new Error(`HTTP 404 from ${url}`));
  };
  return { fn, calls };
}

describe("TemplateRegistry — v2 beside the v1 airline path", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-registry-"));
    fs.mkdirSync(path.join(tmp, "builtin"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function makeRegistry(fetchJson: (url: string) => Promise<unknown>): TemplateRegistry {
    return new TemplateRegistry({
      fetchJson,
      baseUrl: BASE,
      builtinDir: path.join(tmp, "builtin"),
      cacheDir: path.join(tmp, "cache"),
      appVersion: "2.7.0",
    });
  }

  it("an unreachable v2 index leaves the v1 sync exactly as it was", async () => {
    const { fn, calls } = fakeFetch(v1Routes);
    const registry = makeRegistry(fn);

    const count = await registry.syncNow();

    expect(count).toBe(1);
    expect(registry.getTemplate("XX")).toEqual(airline);
    expect(registry.getStatus()).toEqual([
      { iata: "XX", airline: "Example Air", version: "2026-01", source: "cached" },
    ]);
    // The v1 requests are the URLs the pre-v2 registry hardcoded, in its order.
    expect(calls.filter((u) => u !== V2_INDEX)).toEqual([
      "https://raw.githubusercontent.com/Abrechen2/travstats-templates/main/templates/index.json",
      "https://raw.githubusercontent.com/Abrechen2/travstats-templates/main/templates/XX.json",
    ]);
    expect(fs.existsSync(path.join(tmp, "cache", "XX.json"))).toBe(true);
    expect(registry.getV2Status()).toEqual({ index: "unavailable", templates: [] });
    expect(registry.getActiveV2()).toEqual([]);
  });

  it("a v2 index adds v2 templates and leaves the airlines alone", async () => {
    const t = validTemplate();
    const { fn } = fakeFetch({
      ...v1Routes,
      [V2_INDEX]: {
        version: 2,
        templates: [
          { id: t.id, domain: t.domain, version: t.version, path: "lodging/examplechain.json" },
        ],
      },
      [`${BASE}/lodging/examplechain.json`]: t,
    });
    const registry = makeRegistry(fn);

    const count = await registry.syncNow();

    expect(count).toBe(1);
    expect(registry.getTemplate("XX")).toEqual(airline);
    expect(registry.getActiveV2().map((x) => x.id)).toEqual(["lodging:examplechain"]);
    expect(registry.getV2Status().index).toBe("available");
    // v2 is cached in its own directory, which the v1 cache reader does not descend into.
    expect(fs.existsSync(path.join(tmp, "cache", "v2", "lodging__examplechain.json"))).toBe(true);
  });
});
