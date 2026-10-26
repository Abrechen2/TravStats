import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { germanUseTranslation } from "../../../__tests__/helpers/germanT";
import UnconfirmedCountries from "../UnconfirmedCountries";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => germanUseTranslation(),
}));

/**
 * Unconfirmed track countries name their source (TravTrack plan E6): a
 * Dawarich-only list reads exactly as before TravTrack; TravTrack's
 * observations are their own entries, never merged into Dawarich's.
 */
const row = (code: string, source: "dawarich" | "travtrack") => ({
  code,
  source,
  reason: "ground-unconfirmed" as const,
  observedDays: 2,
  pointCount: 30,
  firstDate: "2026-10-12",
  lastDate: "2026-10-13",
});

describe("UnconfirmedCountries", () => {
  it("a Dawarich-only list keeps its Dawarich wording", () => {
    render(<UnconfirmedCountries countries={[row("EE", "dawarich")]} locale="de" />);
    expect(screen.getByText(/Diese Dawarich-Standorte/)).toBeInTheDocument();
    expect(screen.getByText(/^Dawarich · Standorttage: 2/)).toBeInTheDocument();
  });

  it("names TravTrack's entries as TravTrack's, beside Dawarich's for the same country", () => {
    render(
      <UnconfirmedCountries
        countries={[row("EE", "dawarich"), row("EE", "travtrack")]}
        locale="de"
      />
    );
    expect(screen.getByText(/aus deinem Standortverlauf/)).toBeInTheDocument();
    expect(screen.getByText(/^Dawarich · Standorttage/)).toBeInTheDocument();
    expect(screen.getByText(/^TravTrack · Standorttage/)).toBeInTheDocument();
  });
});
