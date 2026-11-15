import { describe, expect, it } from "vitest";
import { draftFrom } from "../railFormModel";
import { missingSteps, withDayOnly, withStation, withTime } from "../railFormEdits";

/**
 * The draft edits and the "still missing" list were inline in the form
 * (forgejo#386 REF-15); they are pure now and pinned here.
 */
const station = (name: string, lat: number | null, lon: number | null) =>
  ({ ...draftFrom(null).departure, name, lat, lon }) as ReturnType<typeof draftFrom>["departure"];

const base = () => {
  const d = draftFrom(null);
  return {
    ...d,
    departure: station("Berlin Hbf", 52.5, 13.37),
    arrival: station("München Hbf", 48.14, 11.56),
    departureLocal: "2026-10-01T08:00",
    departureFold: "later" as const,
  };
};

const t = ((key: string) => key) as never;

describe("withStation", () => {
  it("clears the stored occurrence when the station moved, keeps it for a rename", () => {
    const d = base();
    expect(
      withStation(d, "departure", station("Berlin Spandau", 52.53, 13.2)).departureFold
    ).toBeNull();
    expect(
      withStation(d, "departure", station("Berlin Hauptbahnhof", 52.5, 13.37)).departureFold
    ).toBe("later");
  });
});

describe("withTime", () => {
  it("ends the occurrence on a new time and gives it back on the opening clock at the opening station", () => {
    const opened = base();
    const typed = withTime(opened, opened, "departure", "2026-10-01T09:00");
    expect(typed.departureFold).toBeNull();
    const back = withTime(typed, opened, "departure", opened.departureLocal);
    expect(back.departureFold).toBe("later");
  });
});

describe("withDayOnly", () => {
  it("keeps the day when switching to day-only and drops the occurrence", () => {
    const d = withDayOnly(base(), "departure", true);
    expect(d.departureDayOnly).toBe(true);
    expect(d.departureLocal).toBe("2026-10-01");
    expect(d.departureFold).toBeNull();
  });
});

describe("missingSteps", () => {
  it("names a missing departure time and a refused coordinate, each with its field", () => {
    const d = { ...base(), departureLocal: "" };
    const steps = missingSteps(d, "lon", null, "rail-departureLocal", t);
    expect(steps.map((s) => s.field)).toEqual(["rail-dep-lon", "rail-departureLocal"]);
  });

  it("is empty for a complete draft", () => {
    expect(missingSteps(base(), null, null, "x", t)).toEqual([]);
  });
});
