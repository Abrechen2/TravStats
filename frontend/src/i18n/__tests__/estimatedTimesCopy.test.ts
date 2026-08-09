import { describe, it, expect } from "vitest";
import de from "../resources/de/flights.json";
import en from "../resources/en/flights.json";

/**
 * Issue #235. The arrival-time estimate is computed by feeding
 * `estimateFlightTimes` a boarding time that `useFlightForm` SYNTHESISES by
 * subtracting 30 minutes from the departure time the user typed. That is an
 * internal adaptation to an estimator whose API happens to be boarding-shaped
 * — the user never supplies a boarding time anywhere in this flow, and the
 * manual form has no such field.
 *
 * The copy nonetheless explained the result as "based on boarding time" and
 * "Departure = Boarding + 30min", telling the user their times were derived
 * from an input they never gave. It reads as a bug, or sends them hunting for
 * a field that does not exist.
 *
 * These strings must describe what actually happened: departure time plus
 * flight distance.
 */
describe("estimated-times copy (#235)", () => {
  const keys = ["form.estimatedTimesAutomatic", "form.estimatedTimesAssumption"] as const;

  const read = (bundle: Record<string, unknown>, path: string): string => {
    const value = path
      .split(".")
      .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], bundle);
    expect(typeof value).toBe("string");
    return value as string;
  };

  it("never claims a boarding time was used", () => {
    for (const key of keys) {
      expect(read(de, key).toLowerCase()).not.toContain("boarding");
      expect(read(en, key).toLowerCase()).not.toContain("boarding");
    }
  });

  it("still names what the estimate IS based on, in both languages", () => {
    expect(read(de, "form.estimatedTimesAutomatic").toLowerCase()).toContain("abflug");
    expect(read(en, "form.estimatedTimesAutomatic").toLowerCase()).toContain("departure");
  });

  it("keeps the duration placeholder so the estimate stays visible", () => {
    expect(read(de, "form.estimatedTimesAssumption")).toContain("{{minutes}}");
    expect(read(en, "form.estimatedTimesAssumption")).toContain("{{minutes}}");
  });
});
