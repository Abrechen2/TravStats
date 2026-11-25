import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import LinkExistingPanel from "../LinkExistingPanel";
import type { LinkPreview } from "../../../types/sharingLink";

const candidate = {
  id: "t2",
  name: "Portugal",
  startDay: "2030-06-01",
  endDay: "2030-06-10",
  reason: "period" as const,
};
const dryRun: LinkPreview = {
  access: "full",
  here: { id: "t1", name: "Portugal 2030", startDay: "2030-06-01", endDay: "2030-06-10" },
  there: { id: "t2", name: "Portugal", startDay: "2030-06-01", endDay: "2030-06-10" },
  counts: { matched: 2, onlyHere: 0, onlyThere: 1, conflicting: 1 },
  byType: [{ entity: "lodgingStay", here: 1, there: 2, matched: 1, differing: 0 }],
  matched: [
    {
      entity: "flight",
      label: "TP571 FRA → LIS",
      when: "2030-06-01T08:00:00.000Z",
      linked: false,
      conflicts: [{ field: "departureTime", here: "08:00", there: "08:30" }],
    },
  ],
  onlyHere: [],
  onlyThere: [{ entity: "lodgingStay", label: "Pensão Amor", when: "2030-06-05T00:00:00.000Z" }],
};

function setup(overrides: Partial<Parameters<typeof LinkExistingPanel>[0]> = {}) {
  const props = {
    otherName: "Ben",
    loadCandidates: vi.fn().mockResolvedValue({ access: "full", candidates: [candidate] }),
    preview: vi.fn().mockResolvedValue(dryRun),
    link: vi.fn().mockResolvedValue({ linked: 2 }),
    failure: vi.fn((_e: unknown, key: string) => ({ key })),
    onLinked: vi.fn(),
    ...overrides,
  };
  render(<LinkExistingPanel {...props} />);
  return props;
}

describe("LinkExistingPanel — link an existing copy (forgejo#440)", () => {
  it("shows the dry run and writes nothing before the decision is confirmed", async () => {
    const props = setup();
    fireEvent.click(await screen.findByRole("button", { name: "sharing:link.compare" }));
    await waitFor(() => expect(props.preview).toHaveBeenCalledWith("t2"));
    expect(await screen.findByText(/Pensão Amor/)).toBeInTheDocument();
    expect(screen.getByText(/TP571 FRA → LIS/)).toBeInTheDocument();
    expect(props.link).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("sharing:link.decision.theirs"));
    fireEvent.click(screen.getByRole("button", { name: "sharing:link.confirm" }));
    await waitFor(() => expect(props.link).toHaveBeenCalledWith("t2", "theirs"));
    expect(props.onLinked).toHaveBeenCalledWith({ linked: 2 }, "t2");
  });

  it("a failed comparison is said, not swallowed", async () => {
    setup({ preview: vi.fn().mockRejectedValue(new Error("boom")) });
    fireEvent.click(await screen.findByRole("button", { name: "sharing:link.compare" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("sharing:link.errors.previewFailed");
  });

  it("no matching trip on the other side says so", async () => {
    setup({ loadCandidates: vi.fn().mockResolvedValue({ access: "full", candidates: [] }) });
    expect(await screen.findByText("sharing:link.noCandidates")).toBeInTheDocument();
  });
});

describe("LinkExistingPanel — before the other side agreed", () => {
  it("says the other side must accept first and shows no trip, count or link button", async () => {
    const props = setup({
      loadCandidates: vi.fn().mockResolvedValue({ access: "awaitingConsent" }),
    });
    expect(await screen.findByTestId("link-awaiting-consent")).toHaveTextContent(
      "sharing:link.awaitingConsent"
    );
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("button", { name: "sharing:link.compare" })).toBeNull();
    expect(screen.queryByRole("button", { name: "sharing:link.confirm" })).toBeNull();
    expect(props.preview).not.toHaveBeenCalled();
  });

  it("an awaiting answer to the comparison shows the same sentence, no dry run", async () => {
    setup({ preview: vi.fn().mockResolvedValue({ access: "awaitingConsent" }) });
    fireEvent.click(await screen.findByRole("button", { name: "sharing:link.compare" }));
    expect(await screen.findByTestId("link-awaiting-consent")).toBeInTheDocument();
    expect(screen.queryByText(/Pensão Amor/)).toBeNull();
    expect(screen.queryByRole("button", { name: "sharing:link.confirm" })).toBeNull();
  });
});
