import { describe, expect, it } from "vitest";
import { dashboardYearHref, domainListHref, monthFromSearch, yearFromSearch } from "../yearLinks";

describe("year card links", () => {
  it("the Karte link carries the year as the dashboard's ?year= param", () => {
    expect(dashboardYearHref(2024)).toBe("/dashboard?year=2024");
  });

  it("a domain list gets the year, and flights also the month", () => {
    expect(domainListHref("rail", 2024, 3)).toBe("/rail?year=2024&month=3");
    expect(domainListHref("cruise", 2024, 3)).toBe("/cruises?year=2024&month=3");
    expect(domainListHref("roadtrip", 2024, 3)).toBe("/roadtrips?year=2024");
    expect(domainListHref("flight", 2024, 3)).toBe("/flights?year=2024&month=3");
    expect(domainListHref("rental", 2023)).toBe("/rentals?year=2023");
  });

  it("reads only a plausible year or month, nothing else", () => {
    expect(yearFromSearch("?year=2024")).toBe(2024);
    expect(yearFromSearch("?year=24")).toBeNull();
    expect(yearFromSearch("?year=abc")).toBeNull();
    expect(yearFromSearch("?year=99999")).toBeNull();
    expect(yearFromSearch("")).toBeNull();
    expect(monthFromSearch("?month=12")).toBe(12);
    expect(monthFromSearch("?month=13")).toBeNull();
    expect(monthFromSearch("?month=0")).toBeNull();
  });
});
