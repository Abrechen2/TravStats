import { WEB_PREF_SECTIONS, webPrefValueProblem } from "../sections";

describe("flightTimeHistory web-prefs section (forgejo#407, H15)", () => {
  const entry = (n: number) => ({
    flightNumber: `LH${1000 + n}`,
    departureIata: "FRA",
    arrivalIata: "JFK",
    boardingTime: "09:30",
    departureTime: "10:00",
    arrivalTime: "13:00",
    date: "2024-01-01",
  });

  it("is a known section, so the server keeps it instead of dropping it", () => {
    expect(WEB_PREF_SECTIONS).toHaveProperty("flightTimeHistory", "object");
  });

  it("holds the sixty newest samples the web sends within the section bound", () => {
    const value = { entries: Array.from({ length: 60 }, (_, i) => entry(i)) };
    expect(webPrefValueProblem("flightTimeHistory", value)).toBeNull();
    expect(JSON.stringify(value).length).toBeLessThan(16 * 1024);
  });
});
