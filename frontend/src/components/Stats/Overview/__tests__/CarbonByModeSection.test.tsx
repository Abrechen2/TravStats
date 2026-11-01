import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { Co2ModeStats, Co2Stats } from "../../../../types/co2";
import { EVIDENCE_MEASURES } from "../../../../shared/evidenceMeasures";

const getCo2 = vi.fn();
vi.mock("../../../../lib/api/stats", () => ({ statsApi: { getCo2: () => getCo2() } }));

const hidden = vi.hoisted(() => ({ keys: new Set<string>() }));
vi.mock("../../../../hooks/useDomainVisible", () => ({
  useDomainVisible: (key: string): boolean => !hidden.keys.has(key),
}));

import CarbonByModeSection from "../CarbonByModeSection";

/**
 * Carbon per mode (forgejo#395): every tile opens the records behind it, a
 * mode that could not be measured shows "–" instead of 0 kg, and the cruise is
 * labelled a lower bound.
 */
const mode = (over: Partial<Co2ModeStats> & Pick<Co2ModeStats, "mode">): Co2ModeStats => ({
  records: 0,
  measured: 0,
  kg: null,
  distanceKm: 0,
  lowerBound: false,
  kinds: [],
  savedVsFlightKg: null,
  comparedRides: 0,
  ...over,
});

const response = (): Co2Stats => ({
  flights: { records: 2, measured: 2, kg: 300 },
  modes: [
    mode({
      mode: "rail",
      records: 3,
      measured: 2,
      kg: 17.7,
      savedVsFlightKg: 90.3,
      comparedRides: 2,
    }),
    mode({ mode: "bus", records: 1, measured: 0, kg: null }),
    mode({ mode: "cruise", records: 1, measured: 1, kg: 112.7, lowerBound: true }),
  ],
  totalKg: 430.4,
  savedVsFlightKg: 90.3,
  comparedRides: 2,
  source: { publisher: "UK DESNZ", title: "x", year: 2025, url: "https://example.org" },
});

function Probe({ onChange }: { onChange: (search: string) => void }): null {
  onChange(useLocation().search);
  return null;
}

describe("CarbonByModeSection", () => {
  beforeEach(() => {
    getCo2.mockReset();
    hidden.keys.clear();
    cleanup();
  });

  it("shows an unmeasurable mode as a dash, never as 0 kg, and the cruise as a lower bound", async () => {
    getCo2.mockResolvedValue(response());
    render(
      <MemoryRouter>
        <CarbonByModeSection />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByTestId("carbon-by-mode")).toBeTruthy());
    const text = screen.getByTestId("carbon-by-mode").textContent ?? "";
    expect(text).not.toMatch(/(^|\D)0 kg/);
    expect(text).toContain("–");
    expect(text).toContain("≥ 113 kg");
    expect(text).toContain("≈ 18 kg");
  });

  it("opens served measures from its tiles, one per mode that has a figure", async () => {
    getCo2.mockResolvedValue(response());
    let search = "";
    render(
      <MemoryRouter>
        <CarbonByModeSection />
        <Probe onChange={(next) => (search = next)} />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getAllByRole("button").length).toBeGreaterThan(0));
    const keys: string[] = [];
    for (const trigger of screen.getAllByRole("button")) {
      await act(async () => {
        trigger.click();
      });
      const raw = new URLSearchParams(search).get("evidence") ?? "";
      keys.push(raw.slice(raw.indexOf(":") + 1));
    }
    expect(keys.sort()).toEqual(
      ["co2CruiseKg", "co2FootprintKg", "co2RailKg", "co2SavedVsFlightKg"].sort()
    );
    for (const key of keys) expect(EVIDENCE_MEASURES[key]?.scopes).toContain("allTime");
  });

  it("builds its total from the modes on screen, not from a hidden domain's records", async () => {
    hidden.keys.add("rail");
    getCo2.mockResolvedValue(response());
    render(
      <MemoryRouter>
        <CarbonByModeSection />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByTestId("carbon-by-mode")).toBeTruthy());
    const text = screen.getByTestId("carbon-by-mode").textContent ?? "";
    // The sentence lists only what is on screen; the server's total also holds the hidden rail.
    expect(text).toContain("common:co2.modes.flight 300 kg + common:co2.modes.cruise 113 kg");
    expect(text).not.toContain("common:co2.modes.rail");
    expect(text).not.toContain("stats:carbon.savedDescription");
  });

  it("says why the figures are missing and retries, instead of vanishing on a failed request", async () => {
    getCo2.mockRejectedValueOnce({ response: { status: 500 } });
    getCo2.mockResolvedValueOnce(response());
    render(
      <MemoryRouter>
        <CarbonByModeSection />
      </MemoryRouter>
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("stats:carbon.loadError");
    expect(alert.textContent).toContain("stats:carbon.reasonStatus");
    await act(async () => {
      screen.getByRole("button", { name: /retry/i }).click();
    });
    await waitFor(() => expect(screen.getByTestId("carbon-by-mode")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
