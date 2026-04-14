/**
 * Unit tests for getEnrichmentMode — the null-departureTime behaviour added
 * in 0.24.3 specifically for historical flights where the user doesn't know
 * the date.
 */
import { describe, it, expect } from "@jest/globals";

jest.mock("../db", () => ({
  prisma: {},
}));

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { getEnrichmentMode } from "../services/flightEnrichmentService";

describe("getEnrichmentMode", () => {
  it("returns 'slim' for null departure time (historical, unknown age)", () => {
    expect(getEnrichmentMode(null)).toBe("slim");
  });

  it("returns 'slim' for undefined departure time", () => {
    expect(getEnrichmentMode(undefined)).toBe("slim");
  });

  it("returns 'full' for a flight less than 1 year old", () => {
    const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    expect(getEnrichmentMode(threeMonthsAgo)).toBe("full");
  });

  it("returns 'slim' for a flight older than 1 year", () => {
    const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000);
    expect(getEnrichmentMode(twoYearsAgo)).toBe("slim");
  });

  it("returns 'full' for a flight just under 1 year old", () => {
    const elevenMonthsAgo = new Date(Date.now() - 330 * 24 * 60 * 60 * 1000);
    expect(getEnrichmentMode(elevenMonthsAgo)).toBe("full");
  });
});
