import { latestStamp, mergeWebPrefs, readStoredWebPrefs } from "../merge";
import { WEB_PREFS_LIMITS, webPrefValueProblem } from "../sections";

const NOW = new Date("2026-10-04T12:00:00.000Z");

describe("mergeWebPrefs — per-section last-write-wins (forgejo#200)", () => {
  it("keeps sections the write does not name", () => {
    const stored = { theme: { value: { mapTheme: "classic" }, updatedAt: "2026-10-01T00:00:00Z" } };
    const out = mergeWebPrefs(stored, { domainColors: { value: { flight: "#ff0000" } } }, NOW);
    expect(out.ok && out.next.theme?.value).toEqual({ mapTheme: "classic" });
    expect(out.ok && out.next.domainColors?.value).toEqual({ flight: "#ff0000" });
  });

  it("does not apply a write older than the stored section, and names it stale", () => {
    const stored = { theme: { value: { mapTheme: "classic" }, updatedAt: "2026-10-03T00:00:00Z" } };
    const out = mergeWebPrefs(
      stored,
      { theme: { value: { mapTheme: "glassmorphism" }, updatedAt: "2026-10-02T00:00:00Z" } },
      NOW
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.stale).toEqual(["theme"]);
    expect(out.next.theme?.value).toEqual({ mapTheme: "classic" });
  });

  it("accepts a retried write with the same instant", () => {
    const at = "2026-10-03T00:00:00.000Z";
    const stored = { theme: { value: { mapTheme: "classic" }, updatedAt: at } };
    const out = mergeWebPrefs(
      stored,
      { theme: { value: { mapTheme: "classic" }, updatedAt: at } },
      NOW
    );
    expect(out.ok && out.stale).toEqual([]);
  });

  it("caps a device clock running ahead at the server's now", () => {
    const out = mergeWebPrefs(
      {},
      { theme: { value: {}, updatedAt: "2099-01-01T00:00:00.000Z" } },
      NOW
    );
    expect(out.ok && out.next.theme?.updatedAt).toBe(NOW.toISOString());
  });

  it("drops unknown sections and reports them", () => {
    const out = mergeWebPrefs({}, { notASection: { value: {} } }, NOW);
    expect(out.ok && out.dropped).toEqual(["notASection"]);
    expect(out.ok && Object.keys(out.next)).toEqual([]);
  });

  it("refuses the wrong top-level kind with 400", () => {
    const out = mergeWebPrefs({}, { dashboardHiddenDomains: { value: { a: 1 } } }, NOW);
    expect(out).toMatchObject({ ok: false, status: 400, section: "dashboardHiddenDomains" });
  });

  it("refuses an over-large section with 413", () => {
    const big = "x".repeat(WEB_PREFS_LIMITS.maxStringLength);
    const value = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, big]));
    const out = mergeWebPrefs({}, { mapAppearance: { value } }, NOW);
    expect(out).toMatchObject({ ok: false, status: 413, section: "mapAppearance" });
  });

  it("refuses when the account's total would pass its cap", () => {
    const chunk = "y".repeat(WEB_PREFS_LIMITS.maxStringLength);
    const nearlyFull = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`k${i}`, chunk]));
    const stored = Object.fromEntries(
      ["mapAppearance", "globeChrome", "domainColors", "theme"].map((s) => [
        s,
        { value: nearlyFull, updatedAt: "2026-10-01T00:00:00Z" },
      ])
    );
    const out = mergeWebPrefs(stored, { statsCompare: { value: nearlyFull } }, NOW);
    expect(out).toMatchObject({ ok: false, status: 413, section: null });
  });
});

describe("webPrefValueProblem — bounded, not schema-strict", () => {
  it("refuses nesting past the depth bound without recursing", () => {
    let deep: unknown = {};
    for (let i = 0; i < 10_000; i += 1) deep = { d: deep };
    expect(webPrefValueProblem("mapAppearance", deep)).toBe("is nested too deeply");
  });

  it("refuses a too-wide object", () => {
    const wide = Object.fromEntries(
      Array.from({ length: WEB_PREFS_LIMITS.maxWidth + 1 }, (_, i) => [`k${i}`, 1])
    );
    expect(webPrefValueProblem("tablePrefs", wide)).toBe("has too many entries");
  });

  it("accepts an ordinary map appearance", () => {
    expect(
      webPrefValueProblem("mapAppearance", {
        styleId: "dark",
        flightColorMode: "solid",
        flightColors: { solid: [255, 0, 0] },
        flightRouteWidth: 1.4,
        showTerrain: false,
        airportColor: null,
      })
    ).toBeNull();
  });
});

describe("readStoredWebPrefs", () => {
  it("serves only well-formed known sections", () => {
    const out = readStoredWebPrefs({
      theme: { value: { mapTheme: "classic" }, updatedAt: "2026-10-01T00:00:00Z" },
      unknown: { value: {}, updatedAt: "2026-10-01T00:00:00Z" },
      statsCompare: { value: {} },
      dashboardHiddenDomains: { value: "nope", updatedAt: "2026-10-01T00:00:00Z" },
    });
    expect(Object.keys(out)).toEqual(["theme"]);
  });

  it("reads anything that is not an object as empty", () => {
    expect(readStoredWebPrefs(null)).toEqual({});
    expect(readStoredWebPrefs([1, 2])).toEqual({});
  });
});

describe("latestStamp", () => {
  it("is the newest section instant, or null", () => {
    expect(latestStamp({})).toBeNull();
    expect(
      latestStamp({
        theme: { value: {}, updatedAt: "2026-10-01T00:00:00.000Z" },
        statsCompare: { value: {}, updatedAt: "2026-10-02T00:00:00.000Z" },
      })
    ).toBe("2026-10-02T00:00:00.000Z");
  });
});
