import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
const lookup = vi.fn();
const lookupProviders = vi.fn();
vi.mock("../../../lib/api/rail", () => ({
  railApi: {
    lookup: (...a: unknown[]) => lookup(...a),
    lookupProviders: (...a: unknown[]) => lookupProviders(...a),
  },
}));

import { RailLookupPanel, lookupQueryFrom, noMatchReason } from "../RailLookupPanel";
import { draftFrom, type RailFormDraft } from "../railFormModel";
import type { RailLookupAnswer } from "../../../types/rail";

const BOTH_ON = {
  transitous: true,
  dbRest: true,
  transitousSourcesUrl: "https://transitous.org/sources/",
};

function draft(over: Partial<RailFormDraft> = {}): RailFormDraft {
  return {
    ...draftFrom(null),
    trainNumber: "696",
    trainCategory: "ICE",
    departure: {
      name: "Frankfurt (Main) Hbf",
      lat: 50.107149,
      lon: 8.663785,
      country: "DE",
      code: "8011068",
      stationId: 7604,
    },
    ...over,
  };
}

const attempts = (...outcomes: string[]): RailLookupAnswer["attempts"] =>
  outcomes.map((outcome, i) => ({
    provider: i === 0 ? "transitous" : "db-rest",
    outcome: outcome as RailLookupAnswer["attempts"][number]["outcome"],
  }));

describe("lookupQueryFrom", () => {
  it("names the boarding station by its catalogue id when it has one", () => {
    expect(lookupQueryFrom(draft(), "2026-09-26")).toEqual({
      trainNumber: "696",
      category: "ICE",
      date: "2026-09-26",
      fromStationId: 7604,
    });
  });

  it("falls back to the position for a geocoder station", () => {
    const d = draft();
    const q = lookupQueryFrom(
      { ...d, departure: { ...d.departure, stationId: null } },
      "2026-09-26"
    );
    expect(q).toMatchObject({ fromLat: 50.107149, fromLon: 8.663785 });
    expect(q).not.toHaveProperty("fromStationId");
  });

  it("is not ready without a number or a departure station", () => {
    expect(lookupQueryFrom(draft({ trainNumber: " " }), "2026-09-26")).toBeNull();
    expect(
      lookupQueryFrom(draft({ departure: draftFrom(null).departure }), "2026-09-26")
    ).toBeNull();
  });
});

describe("noMatchReason", () => {
  it("keeps 'the service did not answer' apart from 'no such train'", () => {
    expect(noMatchReason({ match: null, attempts: attempts("unavailable", "unavailable") })).toBe(
      "unavailable"
    );
    expect(noMatchReason({ match: null, attempts: attempts("noMatch", "unavailable") })).toBe(
      "noMatch"
    );
    expect(noMatchReason({ match: null, attempts: attempts("disabled", "notApplicable") })).toBe(
      "disabled"
    );
  });
});

describe("RailLookupPanel", () => {
  beforeEach(() => {
    lookup.mockReset();
    lookupProviders.mockReset();
    lookupProviders.mockResolvedValue(BOTH_ON);
  });

  const renderPanel = (d = draft(), onApply = vi.fn()) =>
    render(
      <RailLookupPanel draft={d} onApply={onApply} onClearLookup={vi.fn()} inputClassName="" />
    );

  it("warns before the lookup that a past day rarely finds anything", async () => {
    renderPanel(draft({ departureLocal: "2024-06-01T08:00" }));
    expect(await screen.findByText("rail:lookup.pastDay")).toBeInTheDocument();
  });

  it("says why a lookup found nothing", async () => {
    lookup.mockResolvedValue({ match: null, attempts: attempts("unavailable", "unavailable") });
    renderPanel(draft({ departureLocal: "2026-09-26T08:00" }));
    fireEvent.click(await screen.findByRole("button", { name: "rail:lookup.run" }));
    expect(await screen.findByRole("status")).toHaveTextContent("rail:lookup.none.unavailable");
  });

  it("credits Transitous with a link to its sources", async () => {
    renderPanel();
    const link = await screen.findByRole("link", { name: "Transitous" });
    expect(link).toHaveAttribute("href", "https://transitous.org/sources/");
  });

  it("offers nothing to press when the admin switched both providers off", async () => {
    lookupProviders.mockResolvedValue({ ...BOTH_ON, transitous: false, dbRest: false });
    renderPanel();
    expect(await screen.findByText("rail:lookup.switchedOff")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "rail:lookup.run" })).toBeNull();
  });
});
