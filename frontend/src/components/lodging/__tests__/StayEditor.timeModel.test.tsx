import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StayEditor } from "../StayEditor";
import { createStay, listMemberships, getFxPreview } from "../../../lib/api/lodging";
import { tripsApi } from "../../../lib/api";

// Mocked at the resolved-module level — StayEditor.tsx imports the same
// "../../lib/api/lodging" file (this test lives 3 dirs under src, matching
// the 3-level "../../../lib/api/lodging" specifier here).
// The documents section fetches its entry's kept originals on mount. It has
// its own suite, and `__tests__/documentsMountPoints.test.tsx` checks that
// this surface mounts it — here it would only be a request reaching the
// network, which the setup refuses (forgejo#110).
// The form asks for the user's own lodging vocabulary on mount; no network here.
vi.mock("../../../hooks/useLodgingEntrySuggestions", () => ({
  useLodgingEntrySuggestions: () => ({
    amenities: [],
    roomAmenities: [],
    roomNumbers: [],
    roomCategories: [],
    boards: [],
  }),
}));
vi.mock("../../documents/DocumentsSection", () => ({ default: () => null }));

vi.mock("../../../lib/api/lodging", () => ({
  createStay: vi.fn(),
  updateStay: vi.fn(),
  listMemberships: vi.fn(),
  getFxPreview: vi.fn(),
}));

vi.mock("../../../lib/api", () => ({
  tripsApi: { getAll: vi.fn() },
}));

// The currency picker asks the server which currencies were used recently. The
// hook fetches on mount, so it reached the network from every test that renders
// a price field (forgejo#110); an empty list is the failed request's own result.
vi.mock("@/hooks/useRecentCurrencies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useRecentCurrencies")>();
  return { ...actual, useRecentCurrencies: () => [] };
});

/**
 * The stay editor under the time model (ADR 0002): check-in and check-out are
 * days, and the check-in TIME is placed in the lodging's zone by the server.
 * A lodging without a position has no zone — the refusal must read as the
 * sentence for that code, and a stale bundle is asked to reload.
 */
describe("StayEditor — time model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listMemberships).mockResolvedValue([]);
    vi.mocked(tripsApi.getAll).mockResolvedValue([]);
    vi.mocked(getFxPreview).mockResolvedValue(null);
  });

  const saveWithTime = async (code: string): Promise<void> => {
    vi.mocked(createStay).mockRejectedValue({
      isAxiosError: true,
      response: { status: 422, data: { error: "English prose for a log", code } },
    });
    render(<StayEditor mode="create" lodgingId="lodging-1" onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("lodging:field.checkIn"), {
      target: { value: "2027-03-28" },
    });
    fireEvent.change(screen.getByLabelText("lodging:field.checkOut"), {
      target: { value: "2027-03-29" },
    });
    await userEvent.click(screen.getByTestId("stay-editor-save"));
    await waitFor(() => expect(createStay).toHaveBeenCalled());
    expect(vi.mocked(createStay).mock.calls[0][1].checkIn).toBe("2027-03-28");
  };

  it("shows TZ_UNRESOLVED as the no-zone sentence, never the server's text", async () => {
    await saveWithTime("TZ_UNRESOLVED");
    expect(await screen.findByText("common:saveErrors.timezoneUnresolved")).toBeInTheDocument();
    expect(screen.queryByText(/English prose/)).not.toBeInTheDocument();
  });

  it("shows the clock-change sentence for a check-in time in the gap", async () => {
    await saveWithTime("LOCAL_TIME_NONEXISTENT");
    expect(await screen.findByText("common:saveErrors.localTimeNonexistent")).toBeInTheDocument();
  });

  it("asks a stale page to reload", async () => {
    await saveWithTime("TIME_SHAPE_REQUIRED");
    expect(await screen.findByText("common:saveErrors.staleBundle")).toBeInTheDocument();
  });
});
