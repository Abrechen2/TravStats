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
  redacted: false,
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
    loadCandidates: vi.fn().mockResolvedValue({ candidates: [candidate], possibleCopy: true }),
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
    setup({ loadCandidates: vi.fn().mockResolvedValue({ candidates: [], possibleCopy: false }) });
    expect(await screen.findByText("sharing:link.noCandidates")).toBeInTheDocument();
  });
});

describe("LinkExistingPanel — before the other side agreed", () => {
  it("lists no trip of theirs, compares without naming one, shows aggregates only and no link button", async () => {
    const props = setup({
      loadCandidates: vi.fn().mockResolvedValue({ candidates: [], possibleCopy: true }),
      preview: vi.fn().mockResolvedValue({
        ...dryRun,
        redacted: true,
        there: { id: "", name: "", startDay: null, endDay: null },
        counts: { ...dryRun.counts, onlyThere: null },
        byType: [],
        matched: [],
        onlyThere: [],
      }),
    });
    expect(await screen.findByTestId("link-possible-copy")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "sharing:link.compare" }));
    await waitFor(() => expect(props.preview).toHaveBeenCalledWith(null));
    expect(await screen.findByTestId("link-redacted")).toBeInTheDocument();
    expect(screen.queryByText(/Pensão Amor/)).toBeNull();
    expect(screen.queryByText(/TP571/)).toBeNull();
    expect(screen.queryByRole("button", { name: "sharing:link.confirm" })).toBeNull();
  });
});
