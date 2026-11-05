import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { RecordedFields } from "../../../../types/flightInsights";
import { EVIDENCE_MEASURES } from "../../../../shared/evidenceMeasures";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}|${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
  }),
}));

import FlightRecordedFieldsBlock from "../FlightRecordedFieldsBlock";

const FULL: RecordedFields = {
  airborne: { minutes: 150, flights: 1, of: 4 },
  overflown: { countries: ["France", "Germany"], flights: 1, of: 4 },
  codeshare: { codeshare: 2, known: 3, of: 4, operators: [{ name: "TAP", flights: 2 }] },
};

const renderBlock = (recorded: RecordedFields) =>
  render(
    <MemoryRouter>
      <FlightRecordedFieldsBlock recorded={recorded} />
    </MemoryRouter>
  );

describe("FlightRecordedFieldsBlock", () => {
  it("states each figure's coverage instead of presenting it as the whole logbook", () => {
    renderBlock(FULL);
    expect(screen.getByTestId("recorded-airborne").textContent).toContain('"flights":"1","of":"4"');
    expect(screen.getByTestId("recorded-codeshare").textContent).toContain('"known":"3","of":"4"');
    expect(screen.getByTestId("recorded-codeshare").textContent).toContain("TAP (2)");
    expect(screen.getByTestId("recorded-overflown").textContent).toContain("France, Germany");
  });

  it("draws nothing for a field no flight carries, and nothing at all when none does", () => {
    const { container } = renderBlock({ airborne: null, overflown: null, codeshare: null });
    expect(container.innerHTML).toBe("");
    renderBlock({ ...FULL, airborne: null, codeshare: null });
    expect(screen.queryByTestId("recorded-airborne")).toBeNull();
    expect(screen.queryByTestId("recorded-codeshare")).toBeNull();
    expect(screen.getByTestId("recorded-overflown")).toBeTruthy();
  });

  it("opens only evidence keys a resolver serves", () => {
    renderBlock(FULL);
    for (const key of [
      "flightAirborneMinutes",
      "flightOverflownCountriesCount",
      "flightCodeshareCount",
    ]) {
      expect(EVIDENCE_MEASURES[key]?.servedIn).toBe(1);
    }
  });
});
