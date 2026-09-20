import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import EnrichmentSection from "../EnrichmentSection";

const SETTINGS = { enabled: true, minConfidence: 70, maxPerDay: 50 };

function renderSection(): void {
  render(
    <MemoryRouter>
      <EnrichmentSection
        historicalEnrichmentSettings={SETTINGS}
        loadingHistoricalEnrichmentSettings={false}
        onSetHistoricalEnrichmentSettings={vi.fn()}
        onSave={vi.fn()}
      />
    </MemoryRouter>
  );
}

describe("EnrichmentSection", () => {
  /**
   * The section wore a "Beta" pill that named no gate. `config/betaFeatures.ts`
   * has never carried a key for historical enrichment, so nothing was hidden
   * behind the badge and nothing would ever have taken it away. Found in the
   * beta audit of 2026-09-19; the owner ruled it off on 2026-09-20.
   *
   * The assertion is on the rendered text rather than on the absence of a
   * `badge` prop, because what was wrong was what the user read.
   */
  it("wears no Beta badge — there is no gate behind it to justify one", () => {
    renderSection();
    expect(screen.queryByText(/beta/i)).toBeNull();
  });

  it("still renders the section and its switch", () => {
    renderSection();
    expect(screen.getByText("settings:historicalEnrichment.title")).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "settings:historicalEnrichment.enabled" })
    ).toBeInTheDocument();
  });
});
