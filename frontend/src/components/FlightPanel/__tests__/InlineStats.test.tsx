import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { InlineStats } from "../InlineStats";
import type { Flight } from "../../../types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

const base = {
  id: "f1",
  departureTime: "2026-01-15T12:00:00Z",
  arrivalTime: "2026-01-15T20:00:00Z",
  depLat: null,
  depLon: null,
  arrLat: null,
  arrLon: null,
  status: "flown",
} as unknown as Flight;

describe("InlineStats duration (forgejo#378)", () => {
  it("does not print the placeholder clocks of a date-only flight as a duration", () => {
    const { container } = render(
      <InlineStats flight={{ ...base, depTimeSemantics: "DATE_ONLY" } as Flight} />
    );
    expect(container.textContent ?? "").not.toMatch(/8h 0m/);
  });

  it("prints no negative duration", () => {
    const { container } = render(
      <InlineStats flight={{ ...base, arrivalTime: "2026-01-15T10:00:00Z" } as Flight} />
    );
    expect(container.textContent ?? "").not.toMatch(/-\d+h/);
  });

  it("prints a measured duration for real clocks", () => {
    render(<InlineStats flight={base} />);
    expect(screen.getByText(/8h 0m/)).toBeInTheDocument();
  });
});
