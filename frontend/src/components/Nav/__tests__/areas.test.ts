import { describe, it, expect } from "vitest";
import { areaForPath, effectiveArea, planMenu, trackMenu } from "../areas";
import { isLeafActive } from "../useNavItems";

const t = (key: string) => key;

describe("areas — the header's area follows the route (phase 5, variant B)", () => {
  it.each([
    ["/plan", "plan"],
    ["/plan/admin", "plan"],
    ["/plan/abc/budget", "plan"],
    ["/track", "track"],
    ["/track/2026-10-12", "track"],
    ["/track/explored", "track"],
    ["/dashboard", "stats"],
    ["/trips/t1", "stats"],
    ["/planet", "stats"],
    ["/tracker", "stats"],
  ])("%s is %s", (path, area) => {
    expect(areaForPath(path)).toBe(area);
  });

  it("falls back to Stats when the route's area is not offered", () => {
    expect(effectiveArea("/track/months", ["stats"])).toBe("stats");
    expect(effectiveArea("/track/months", ["stats", "track"])).toBe("track");
    expect(effectiveArea("/plan", ["stats", "track"])).toBe("stats");
  });
});

describe("trackMenu", () => {
  const menu = trackMenu(t);
  const active = (path: string) => menu.filter((l) => isLeafActive(l, path)).map((l) => l.id);

  it("offers Karte, Erkundet, Statistik, Aufenthalte and Importe, in that order", () => {
    expect(menu.map((l) => [l.path, l.label])).toEqual([
      ["/track", "track:menu.map"],
      ["/track/explored", "track:menu.explored"],
      ["/track/months", "track:menu.stats"],
      ["/track/stays", "track:menu.stays"],
      ["/track/imports", "track:menu.imports"],
    ]);
  });

  it("marks exactly one entry: Karte for a day, never for a sibling view", () => {
    expect(active("/track")).toEqual(["track-map"]);
    expect(active("/track/2026-10-12")).toEqual(["track-map"]);
    expect(active("/track/explored")).toEqual(["track-explored"]);
    expect(active("/track/months")).toEqual(["track-months"]);
    expect(active("/track/stays")).toEqual(["track-stays"]);
    expect(active("/track/imports")).toEqual(["track-imports"]);
  });
});

describe("planMenu", () => {
  it("offers the configuration to admins only", () => {
    expect(planMenu(t, false).map((l) => l.path)).toEqual(["/plan"]);
    expect(planMenu(t, true).map((l) => l.path)).toEqual(["/plan", "/plan/admin"]);
  });

  it("marks Pläne on a plan's sections, not on the configuration", () => {
    const [plans, config] = planMenu(t, true);
    expect(isLeafActive(plans, "/plan/abc/budget")).toBe(true);
    expect(isLeafActive(plans, "/plan/admin")).toBe(false);
    expect(isLeafActive(config, "/plan/admin")).toBe(true);
  });
});
