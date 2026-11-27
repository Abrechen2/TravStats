import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
    i18n: { language: "de" },
  }),
}));
const api = vi.hoisted(() => ({
  receivedProposals: vi.fn(),
  declineProposal: vi.fn(),
  proposalCandidates: vi.fn(),
  proposalPreview: vi.fn(),
  proposalLink: vi.fn(),
  proposalBulkPairs: vi.fn(),
  leave: vi.fn(),
}));
vi.mock("../../../lib/api/sharingLink", () => ({ sharingLinkApi: api }));

import ReceivedLinkProposals from "../ReceivedLinkProposals";

/**
 * Codex P1 (2026-11-27): a local proposal is answered by its recipient, in their inbox — they
 * pick their own trip, look at the dry run and decide, or decline.
 */
const proposal = {
  id: "p1",
  from: { id: "u-anna", displayName: "Anna" },
  trip: { id: "t-anna", name: "Portugal", startDay: "2030-06-01", endDay: "2030-06-10" },
  createdAt: "2026-11-27T10:00:00.000Z",
};

describe("ReceivedLinkProposals", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists a proposal and compares it against the reader's own trips only", async () => {
    api.receivedProposals.mockResolvedValue([proposal]);
    api.proposalCandidates.mockResolvedValue({
      access: "full",
      candidates: [
        {
          id: "t-ben",
          name: "Portugal",
          startDay: "2030-06-01",
          endDay: "2030-06-10",
          reason: "period",
        },
      ],
    });
    api.proposalPreview.mockResolvedValue({ access: "awaitingConsent" });
    render(<ReceivedLinkProposals />);
    expect(await screen.findByText(/sharing:proposals.row/)).toHaveTextContent("Anna");
    fireEvent.click(screen.getByRole("button", { name: "sharing:proposals.link" }));
    await waitFor(() => expect(api.proposalCandidates).toHaveBeenCalledWith("p1"));
    fireEvent.click(await screen.findByRole("button", { name: "sharing:link.compare" }));
    await waitFor(() => expect(api.proposalPreview).toHaveBeenCalledWith("p1", "t-ben"));
  });

  it("declines and reloads; a failed decline is said", async () => {
    api.receivedProposals.mockResolvedValueOnce([proposal]).mockResolvedValue([]);
    api.declineProposal.mockRejectedValueOnce(new Error("down")).mockResolvedValue(undefined);
    render(<ReceivedLinkProposals />);
    fireEvent.click(await screen.findByRole("button", { name: "sharing:proposals.decline" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "sharing:proposals.errors.declineFailed"
    );
    fireEvent.click(screen.getByRole("button", { name: "sharing:proposals.decline" }));
    await waitFor(() => expect(api.declineProposal).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId("link-proposals")).toBeNull());
  });
});
