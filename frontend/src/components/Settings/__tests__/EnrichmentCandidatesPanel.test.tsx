import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const enrichmentCandidates = vi.fn();
const enrichHistorical = vi.fn();
vi.mock("../../../lib/api/flights", () => ({
  flightsApi: {
    enrichmentCandidates: () => enrichmentCandidates(),
    enrichHistorical: (id: string) => enrichHistorical(id),
  },
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => (o ? `${key}:${JSON.stringify(o)}` : key),
  }),
}));
let flightOn = true;
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ isEnabled: () => flightOn }),
}));

import EnrichmentCandidatesPanel from "../EnrichmentCandidatesPanel";

const CAND = {
  flightId: "f1",
  flightNumber: "LH123",
  missingFields: ["gate"],
  missingRoute: true,
  ageYears: 2,
  confidence: 80,
  enrichmentMode: "full",
};
const view = () =>
  render(
    <MemoryRouter>
      <EnrichmentCandidatesPanel />
    </MemoryRouter>
  );
const apiFail = (code: string) => ({ response: { status: 400, data: { code } } });

describe("EnrichmentCandidatesPanel (forgejo#397)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flightOn = true;
  });

  it("is absent without the flight domain", () => {
    flightOn = false;
    enrichmentCandidates.mockResolvedValue({ candidates: [], settings: null });
    const { container } = view();
    expect(container).toBeEmptyDOMElement();
  });

  it("says the load failed instead of 'no candidates'", async () => {
    enrichmentCandidates.mockRejectedValue(new Error("500"));
    view();
    expect(await screen.findByRole("alert")).toHaveTextContent("candidates.loadFailed");
    expect(screen.queryByText("settings:historicalEnrichment.candidates.none")).toBeNull();
  });

  it("enriches one flight and points at the inbox", async () => {
    enrichmentCandidates.mockResolvedValue({ candidates: [CAND], settings: {} });
    enrichHistorical.mockResolvedValue({
      pendingUpdateId: "p",
      confidence: 80,
      sourceFlightsCount: 3,
    });
    view();
    await userEvent.click(await screen.findByRole("button", { name: /candidates\.enrich/ }));
    expect(enrichHistorical).toHaveBeenCalledWith("f1");
    expect(await screen.findByRole("status")).toHaveTextContent("candidates.proposed");
    expect(screen.getByRole("link", { name: /openInbox/ })).toHaveAttribute(
      "href",
      "/pending-updates?tab=updates"
    );
  });

  it.each(["ENRICH_NO_REFERENCE", "ENRICH_CONFIDENCE_LOW", "ENRICH_DISABLED"])(
    "names the reason for %s",
    async (code) => {
      enrichmentCandidates.mockResolvedValue({ candidates: [CAND], settings: {} });
      enrichHistorical.mockRejectedValue(apiFail(code));
      view();
      await userEvent.click(await screen.findByRole("button", { name: /candidates\.enrich/ }));
      expect(await screen.findByRole("status")).toHaveTextContent(`candidates.errors.${code}`);
    }
  );

  it("gives an unclassified failure its own sentence", async () => {
    enrichmentCandidates.mockResolvedValue({ candidates: [CAND], settings: {} });
    enrichHistorical.mockRejectedValue(new Error("net"));
    view();
    await userEvent.click(await screen.findByRole("button", { name: /candidates\.enrich/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("candidates.errors.unknown");
  });
});
