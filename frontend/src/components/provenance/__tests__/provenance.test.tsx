import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import RememberedMarker from "../RememberedMarker";
import RememberedEditor from "../RememberedEditor";
import ProvenanceNoticesSection from "../../inbox/ProvenanceNoticesSection";
import { provenanceApi } from "../../../lib/api/provenance";

vi.mock("../../../lib/api/provenance", () => ({
  provenanceApi: { set: vi.fn(), notices: vi.fn(), dismiss: vi.fn() },
}));

beforeEach(() => vi.clearAllMocks());

describe("remembered marker", () => {
  it("marks a remembered entry with its note and date, and nothing else", () => {
    const { rerender } = render(
      <RememberedMarker
        entry={{
          provenance: "remembered",
          rememberedNote: "Sommer 1998",
          rememberedOn: "2026-11-22",
        }}
      />
    );
    const marker = screen.getByTestId("remembered-marker");
    expect(marker.getAttribute("aria-label")).toContain("Sommer 1998");
    expect(marker.getAttribute("aria-label")).toContain("provenance:marker.on");
    for (const provenance of ["recorded", null] as const) {
      rerender(<RememberedMarker entry={{ provenance }} />);
      expect(screen.queryByTestId("remembered-marker")).toBeNull();
    }
  });
});

describe("remembered editor", () => {
  it("sends the chosen origin with the date and the user's words", async () => {
    vi.mocked(provenanceApi.set).mockResolvedValue({
      provenance: "remembered",
      rememberedOn: null,
      rememberedNote: "Sommer 1998",
    });
    const onSaved = vi.fn();
    render(<RememberedEditor entryType="trip" entryId="t-1" initial={null} onSaved={onSaved} />);
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("radio")[2]);
    await user.type(screen.getByRole("textbox"), "Sommer 1998");
    await user.click(screen.getByRole("button"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(provenanceApi.set).toHaveBeenCalledWith("trip", "t-1", {
      provenance: "remembered",
      rememberedOn: null,
      rememberedNote: "Sommer 1998",
    });
  });

  it("says so in place when the save fails instead of looking saved", async () => {
    vi.mocked(provenanceApi.set).mockRejectedValue(new Error("boom"));
    const onSaved = vi.fn();
    render(<RememberedEditor entryType="flight" entryId="f-1" initial={null} onSaved={onSaved} />);
    await userEvent.setup().click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("provenance notices in the inbox", () => {
  const notice = {
    id: "n-1",
    entryType: "trip",
    entryId: "t-1",
    kind: "outsideRememberedSpan" as const,
    detail: {
      remembered: {
        type: "trip",
        id: "t-1",
        label: "Sommer 1998",
        from: "1998-07-01",
        to: "1998-07-14",
      },
      recorded: {
        type: "flight",
        id: "f-1",
        label: "FRA → LIS",
        from: "1998-09-02",
        to: "1998-09-02",
      },
    },
    createdAt: "2026-11-22T00:00:00Z",
  };

  it("shows both readings and drops the notice once it is dismissed", async () => {
    vi.mocked(provenanceApi.notices).mockResolvedValueOnce([notice]).mockResolvedValue([]);
    vi.mocked(provenanceApi.dismiss).mockResolvedValue();
    render(<ProvenanceNoticesSection />);
    expect(await screen.findByText("provenance:notices.title")).toBeTruthy();
    expect(screen.getByText("provenance:notices.outsideRememberedSpan")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button"));
    await waitFor(() => expect(screen.queryByText("provenance:notices.title")).toBeNull());
    expect(provenanceApi.dismiss).toHaveBeenCalledWith("n-1");
  });

  it("says when the notices could not be loaded, never an empty block", async () => {
    vi.mocked(provenanceApi.notices).mockRejectedValue(new Error("down"));
    render(<ProvenanceNoticesSection />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
