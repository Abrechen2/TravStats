import { describe, expect, it, vi } from "vitest";

const locale = vi.hoisted(() => ({ value: "de" }));
vi.mock("../../../lib/units", async (orig) => ({
  ...(await orig<object>()),
  appLocale: () => locale.value,
}));

import { planDay, planRange } from "../format";

describe("plan dates", () => {
  it("planDay formats 2026-10-24 as Sa., 24. Okt. in de", () => {
    locale.value = "de";
    expect(planDay("2026-10-24")).toBe("Sa., 24. Okt.");
  });

  it("planDay abstains on a missing day", () => {
    expect(planDay(null)).toBeNull();
    expect(planDay("")).toBeNull();
  });

  it("planRange collapses the shared month", () => {
    locale.value = "de";
    expect(planRange("2027-05-08", "2027-05-12")).toBe("8.–12. Mai");
    locale.value = "en";
    expect(planRange("2027-05-08", "2027-05-12")).toBe("May 8\u2009–\u200912");
  });

  it("planRange names the year when the range crosses one", () => {
    locale.value = "de";
    expect(planRange("2027-12-28", "2028-01-03")).toBe("28. Dez. 2027\u2009–\u20093. Jan. 2028");
  });

  it("planRange with one end known shows that end only", () => {
    locale.value = "de";
    expect(planRange("2027-05-08", null)).toBe("8. Mai");
    expect(planRange(null, null)).toBeNull();
  });
});
