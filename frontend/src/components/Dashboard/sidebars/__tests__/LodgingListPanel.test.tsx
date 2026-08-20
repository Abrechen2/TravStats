/**
 * Regression for #259: a lodging without coordinates used to be a dead row
 * in this panel — no navigation, no hint. Every row now links to the
 * detail page, and a coordinate-less lodging carries the same "Nicht
 * gefunden" marker as the logbook list.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LodgingListPanel } from "../LodgingListPanel";
import type { Lodging } from "../../../../types/lodging";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && "count" in opts ? `${key}(count:${opts.count})` : key,
    i18n: { language: "de" },
    ready: true,
  }),
}));

function makeLodging(overrides: Partial<Lodging>): Lodging {
  return {
    id: "l1",
    name: "Test Hotel",
    type: "hotel",
    chain: null,
    city: "Berlin",
    lat: 52.5,
    lon: 13.4,
    nights: 2,
    overallRating: null,
    ...overrides,
  } as unknown as Lodging;
}

describe("LodgingListPanel", () => {
  it("links every row to the lodging detail page", () => {
    render(
      <MemoryRouter>
        <LodgingListPanel
          lodgings={[makeLodging({ id: "abc", name: "Canton KOA Holiday" })]}
          isOpen
          onClose={() => {}}
        />
      </MemoryRouter>
    );

    const row = screen.getByText("Canton KOA Holiday").closest("a");
    expect(row).not.toBeNull();
    expect(row).toHaveAttribute("href", "/lodging/abc");
  });

  it("marks a coordinate-less lodging as unlocated", () => {
    render(
      <MemoryRouter>
        <LodgingListPanel
          lodgings={[makeLodging({ id: "abc", lat: null, lon: null })]}
          isOpen
          onClose={() => {}}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("lodging:list.unlocated")).toBeInTheDocument();
  });

  it("shows no marker when coordinates exist", () => {
    render(
      <MemoryRouter>
        <LodgingListPanel lodgings={[makeLodging({})]} isOpen onClose={() => {}} />
      </MemoryRouter>
    );

    expect(screen.queryByText("lodging:list.unlocated")).toBeNull();
  });
});
