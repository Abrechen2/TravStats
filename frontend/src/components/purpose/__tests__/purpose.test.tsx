import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PurposeChip from "../PurposeChip";
import PurposeEditor from "../PurposeEditor";
import PurposeHiddenHint from "../PurposeHiddenHint";
import TripPurposeAction from "../TripPurposeAction";
import { purposeApi } from "../../../lib/api/purpose";
import { visitDraft, visitPayload } from "../../places/visitDialogModel";

vi.mock("../../../lib/api/purpose", () => ({
  purposeApi: { set: vi.fn(), hidden: vi.fn(), previewTrip: vi.fn(), applyToTrip: vi.fn() },
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

// UAT rc.45: one click overwrote every entry's purpose without asking.
describe("TripPurposeAction", () => {
  it("asks first with the count, writes only after the confirmation, then says how many", async () => {
    vi.mocked(purposeApi.previewTrip).mockResolvedValue({ purpose: "business", wouldChange: 4 });
    vi.mocked(purposeApi.applyToTrip).mockResolvedValue({ purpose: "business", changed: 4 });
    const onApplied = vi.fn();
    render(<TripPurposeAction tripId="t1" onApplied={onApplied} />);
    await userEvent.click(screen.getByRole("button", { name: "purpose:trip.apply" }));
    expect(await screen.findByTestId("confirm-modal")).toHaveTextContent("purpose:trip.confirm");
    expect(purposeApi.applyToTrip).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "purpose:trip.confirmAction" }));
    await waitFor(() => expect(purposeApi.applyToTrip).toHaveBeenCalledWith("t1", "business"));
    expect(await screen.findByText("purpose:trip.done")).toBeInTheDocument();
    expect(onApplied).toHaveBeenCalled();
    // UAT rc.45 retest D6: the page reloads after the apply; the toast outlives that.
    const { useToastStore } = await import("../../../store/toastStore");
    expect(useToastStore.getState().toasts.map((x) => x.message)).toContain("purpose:trip.done");
  });

  // D8: its own row, naming the trip's category and what follows from it.
  it("sits in a row of its own that names the trip's category", () => {
    render(<TripPurposeAction tripId="t1" category="vacation" />);
    const row = screen.getByTestId("trip-purpose-row");
    expect(row).toHaveTextContent("purpose:trip.rowTitle");
    expect(row).toHaveTextContent("purpose:trip.rowCategory");
  });

  it("says so and asks nothing when no entry would change", async () => {
    vi.mocked(purposeApi.previewTrip).mockResolvedValue({ purpose: "business", wouldChange: 0 });
    render(<TripPurposeAction tripId="t1" />);
    await userEvent.click(screen.getByRole("button", { name: "purpose:trip.apply" }));
    expect(await screen.findByText("purpose:trip.nothing")).toBeInTheDocument();
    expect(screen.queryByTestId("confirm-modal")).toBeNull();
  });
});
