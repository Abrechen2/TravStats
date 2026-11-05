import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StayEditor } from "../StayEditor";
import {
  createStay,
  updateStay,
  listMemberships,
  getFxPreview,
  getRatingCategories,
} from "../../../lib/api/lodging";
import { tripsApi } from "../../../lib/api";
import { useRatingCategoriesStore } from "../../../store/lodgingRatingCategoriesStore";
import type { LodgingStay } from "../../../types/lodging";

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
  getRatingCategories: vi.fn(),
  listStayPage: vi.fn(async () => ({ rows: [], total: 0 })),
}));
vi.mock("../../../lib/api", () => ({ tripsApi: { getAll: vi.fn() } }));
vi.mock("@/hooks/useRecentCurrencies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useRecentCurrencies")>();
  return { ...actual, useRecentCurrencies: () => [] };
});

const baseStay: LodgingStay = {
  id: "stay-1",
  lodgingId: "lodging-1",
  userId: "user-1",
  tripId: null,
  bookingId: null,
  checkInTime: null,
  checkOutTime: null,
  checkIn: "2026-07-11T00:00:00.000Z",
  checkOut: "2026-07-12T00:00:00.000Z",
  datePrecision: "DAY" as const,
  nights: null,
  status: "completed",
  roomNumber: null,
  roomCategory: null,
  board: "none",
  pricePerNight: null,
  currency: "EUR",
  totalPrice: null,
  totalPriceBase: null,
  fxRate: null,
  fxRateDate: null,
  fxBaseCurrency: null,
  fxSource: null,
  isAwardStay: true,
  ratingRoom: null,
  ratingBreakfast: null,
  ratingService: null,
  ratingOverall: null,
  roomAmenities: [],
  bookingReference: null,
  membershipId: null,
  membershipOptOut: false,
  receiptUrl: null,
  guests: null,
  companions: [],
  notes: null,
  parserTemplate: null,
  parserConfidence: null,
  dataSource: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// The owner's set: Bett and Parkplatz instead of Frühstück, plus an own category.
const OWNER_VIEW = {
  builtIn: [
    "room",
    "bed",
    "bathroom",
    "cleanliness",
    "breakfast",
    "service",
    "location",
    "parking",
    "wifi",
    "quiet",
  ],
  active: ["room", "bed", "parking"],
  custom: [{ id: "c1", key: "custom:c1", name: "Aussicht", deleted: false }],
};

describe("StayEditor — switchable and own rating categories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listMemberships).mockResolvedValue([]);
    vi.mocked(tripsApi.getAll).mockResolvedValue([]);
    vi.mocked(getFxPreview).mockResolvedValue(null);
    vi.mocked(getRatingCategories).mockResolvedValue(OWNER_VIEW);
    useRatingCategoriesStore.setState({ loaded: false });
  });

  it("offers the switched-on categories and an own one, and no breakfast picker", async () => {
    render(<StayEditor mode="create" lodgingId="lodging-1" onClose={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByTestId("star-bed-5");
    expect(screen.getByTestId("star-parking-5")).toBeInTheDocument();
    expect(screen.getByTestId("star-custom:c1-5")).toBeInTheDocument();
    expect(screen.queryByTestId("star-breakfast-5")).toBeNull();
  });

  it("sends the ratings map and derives the overall from the values given", async () => {
    vi.mocked(createStay).mockResolvedValue(baseStay);
    render(<StayEditor mode="create" lodgingId="lodging-1" onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/^lodging:field\.checkIn\b/), {
      target: { value: "2026-07-11" },
    });
    fireEvent.change(screen.getByLabelText(/^lodging:field\.checkOut\b/), {
      target: { value: "2026-07-12" },
    });
    await userEvent.click(await screen.findByTestId("star-bed-5"));
    await userEvent.click(screen.getByTestId("star-custom:c1-3"));
    expect(screen.getByTestId("stay-editor-overall").textContent).toContain("4");
    await userEvent.click(screen.getByTestId("stay-editor-save"));
    await waitFor(() => expect(createStay).toHaveBeenCalled());
    const sent = vi.mocked(createStay).mock.calls[0][1];
    expect(sent.ratings).toEqual({ bed: 5, "custom:c1": 3 });
    expect(sent.ratingOverall).toBe(4);
  });

  it("still shows a switched-off category the stay carries, counts it, and clears it with an explicit null", async () => {
    const stay: LodgingStay = {
      ...baseStay,
      ratingBreakfast: 2,
      ratingRoom: 4,
      ratings: { breakfast: 2, room: 4 },
      ratingOverall: 3,
    };
    vi.mocked(updateStay).mockResolvedValue(stay);
    render(
      <StayEditor
        mode="edit"
        lodgingId="lodging-1"
        stay={stay}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    const retired = await screen.findByTestId("stay-editor-retired-ratings");
    expect(retired.querySelector('[data-testid="star-breakfast-2"]')).not.toBeNull();
    // Switching Frühstück off did not move the old stay's overall.
    expect(screen.getByTestId("stay-editor-overall").textContent).toContain("3");

    // Clear it with its ×.
    await userEvent.click(screen.getByTestId("star-breakfast-clear"));
    expect(screen.getByTestId("stay-editor-overall").textContent).toContain("4");
    await userEvent.click(screen.getByTestId("stay-editor-save"));
    await waitFor(() => expect(updateStay).toHaveBeenCalled());
    expect(vi.mocked(updateStay).mock.calls[0][2].ratings).toEqual({ room: 4, breakfast: null });
  });
});
