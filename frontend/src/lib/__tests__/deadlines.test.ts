import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { cancellationText, deadlineFacts, hasDeadlines } from "../deadlines";

const t = ((key: string, vars?: Record<string, string>) =>
  vars ? `${key}:${Object.values(vars).join("|")}` : key) as unknown as TFunction;

describe("deadline display (forgejo#285)", () => {
  it("a day-only deadline reads 'until the end of' the day, with no time made up", () => {
    const text = cancellationText(
      { freeCancellationOn: { date: "2027-05-01", zone: null, precision: "day" } },
      t,
      "en"
    );
    expect(text).toMatch(/^common:deadlines\.untilEndOfDay:/);
    expect(text).toContain("2027");
    expect(text).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it("an instant reads on its place's clock and names the zone", () => {
    const text = cancellationText(
      {
        freeCancellationUntil: {
          utc: "2027-05-01T09:00:00.000Z",
          zone: "Asia/Tokyo",
          offset: "+09:00",
          local: "2027-05-01T18:00:00",
          precision: "minute",
          zoneSource: "stored",
        },
      },
      t,
      "en"
    );
    expect(text).toContain("6:00 PM");
    expect(text).toContain("(Asia/Tokyo)");
  });

  it("nothing recorded is null, never a placeholder", () => {
    expect(hasDeadlines({})).toBe(false);
    expect(deadlineFacts(undefined, t, "en").every((f) => f.value === null)).toBe(true);
  });
});
