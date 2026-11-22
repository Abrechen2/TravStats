import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PurposeChip from "../PurposeChip";
import PurposeEditor from "../PurposeEditor";
import PurposeHiddenHint from "../PurposeHiddenHint";
import { purposeApi } from "../../../lib/api/purpose";
import { visitDraft, visitPayload } from "../../places/visitDialogModel";

vi.mock("../../../lib/api/purpose", () => ({
  purposeApi: { set: vi.fn(), hidden: vi.fn() },
}));

beforeEach(() => vi.clearAllMocks());

describe("PurposeChip", () => {
  it("shows only for business; private and unknown show nothing", () => {
    const { rerender } = render(<PurposeChip entry={{ purpose: "business" }} />);
    expect(screen.getByTestId("purpose-chip")).toBeInTheDocument();
    rerender(<PurposeChip entry={{ purpose: "private" }} />);
    expect(screen.queryByTestId("purpose-chip")).toBeNull();
    rerender(<PurposeChip entry={{ purpose: null }} />);
    expect(screen.queryByTestId("purpose-chip")).toBeNull();
  });
});

describe("PurposeEditor", () => {
  it("says out loud when the save fails", async () => {
    vi.mocked(purposeApi.set).mockRejectedValue(new Error("boom"));
    render(<PurposeEditor entryType="flight" entryId="f1" purpose={null} />);
    await userEvent.selectOptions(screen.getByRole("combobox"), "business");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("sends null for 'not set'", async () => {
    vi.mocked(purposeApi.set).mockResolvedValue(null);
    render(<PurposeEditor entryType="placeVisit" entryId="v1" purpose="business" />);
    await userEvent.selectOptions(screen.getByRole("combobox"), "");
    await waitFor(() => expect(purposeApi.set).toHaveBeenCalledWith("placeVisit", "v1", null));
  });
});

describe("PurposeHiddenHint", () => {
  it("names what is hidden, and renders nothing when nothing is", async () => {
    vi.mocked(purposeApi.hidden).mockResolvedValue({ poi: { business: 12 } });
    const { unmount } = render(<PurposeHiddenHint />);
    expect(await screen.findByTestId("purpose-hidden-hint")).toHaveTextContent("hidden.business");
    unmount();
    vi.mocked(purposeApi.hidden).mockResolvedValue({});
    render(<PurposeHiddenHint />);
    await waitFor(() => expect(purposeApi.hidden).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("purpose-hidden-hint")).toBeNull();
  });
});

describe("visit form payload", () => {
  it("a create without a choice leaves purpose out so the trip decides; an edit clears with null", () => {
    const draft = visitDraft(null, undefined);
    expect("purpose" in visitPayload(draft, "2025-01-01", "p1", false)).toBe(false);
    expect(visitPayload({ ...draft, purpose: "business" }, "2025-01-01", "p1", false).purpose).toBe(
      "business"
    );
    expect(visitPayload(draft, "2025-01-01", "p1", true).purpose).toBeNull();
  });
});
