import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { StayEditor } from "../StayEditor";
import { listMemberships, getFxPreview } from "../../../lib/api/lodging";
import { tripsApi } from "../../../lib/api";
import type { Trip } from "../../../types";
import type { LodgingStay } from "../../../types/lodging";

// Same module boundary as StayEditor.test.tsx; see there for why each mock exists.
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
vi.mock("@/hooks/useRecentCurrencies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useRecentCurrencies")>();
  return { ...actual, useRecentCurrencies: () => [] };
});

const trips = [
  {
    id: "trip-summer",
    name: "Sommer",
    startDate: "2026-07-01T00:00:00.000Z",
    endDate: "2026-07-14T00:00:00.000Z",
  },
  {
    id: "trip-autumn",
    name: "Herbst",
    startDate: "2026-10-03T00:00:00.000Z",
    endDate: "2026-10-05T00:00:00.000Z",
  },
] as unknown as Trip[];

function tripSelect(): HTMLSelectElement {
  return screen.getByLabelText("lodging:field.trip") as HTMLSelectElement;
}

async function tripsLoaded(): Promise<void> {
  await waitFor(() => expect(screen.getByRole("option", { name: "Sommer" })).toBeInTheDocument());
}

describe("StayEditor — trip preselection by check-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listMemberships).mockResolvedValue([]);
    vi.mocked(tripsApi.getAll).mockResolvedValue(trips);
    vi.mocked(getFxPreview).mockResolvedValue(null);
  });

  it("a new stay picks the trip its check-in falls in, and follows the date", async () => {
    render(<StayEditor mode="create" lodgingId="lodging-1" onClose={vi.fn()} onSaved={vi.fn()} />);
    await tripsLoaded();
    expect(tripSelect().value).toBe("");

    fireEvent.change(screen.getByLabelText("lodging:field.checkIn"), {
      target: { value: "2026-07-14" },
    });
    await waitFor(() => expect(tripSelect().value).toBe("trip-summer"));

    fireEvent.change(screen.getByLabelText("lodging:field.checkIn"), {
      target: { value: "2026-08-01" },
    });
    await waitFor(() => expect(tripSelect().value).toBe(""));
  });

  it("stops following once the user has chosen", async () => {
    render(<StayEditor mode="create" lodgingId="lodging-1" onClose={vi.fn()} onSaved={vi.fn()} />);
    await tripsLoaded();
    fireEvent.change(tripSelect(), { target: { value: "trip-autumn" } });

    fireEvent.change(screen.getByLabelText("lodging:field.checkIn"), {
      target: { value: "2026-07-05" },
    });
    // Give a stray preselection the chance to land before asserting its absence.
    await waitFor(() => expect(tripSelect().value).toBe("trip-autumn"));
  });

  it("an existing stay without a trip stays without one", async () => {
    const stay = {
      id: "stay-1",
      lodgingId: "lodging-1",
      tripId: null,
      checkIn: "2026-07-05T00:00:00.000Z",
      checkOut: "2026-07-06T00:00:00.000Z",
      currency: "EUR",
      companions: [],
      roomAmenities: [],
    } as unknown as LodgingStay;
    render(
      <StayEditor
        mode="edit"
        lodgingId="lodging-1"
        stay={stay}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    await tripsLoaded();
    expect(tripSelect().value).toBe("");
  });

  it("a trip picked with no dates yet gives the new stay the trip's days", async () => {
    render(<StayEditor mode="create" lodgingId="lodging-1" onClose={vi.fn()} onSaved={vi.fn()} />);
    await tripsLoaded();
    fireEvent.change(tripSelect(), { target: { value: "trip-autumn" } });

    expect(screen.getByLabelText("lodging:field.checkIn")).toHaveValue("2026-10-03");
    expect(screen.getByLabelText("lodging:field.checkOut")).toHaveValue("2026-10-05");
  });

  it("with the check-in typed, only offers the trip's last day as check-out", async () => {
    render(<StayEditor mode="create" lodgingId="lodging-1" onClose={vi.fn()} onSaved={vi.fn()} />);
    await tripsLoaded();
    fireEvent.change(screen.getByLabelText("lodging:field.checkIn"), {
      target: { value: "2026-07-10" },
    });
    await waitFor(() => expect(tripSelect().value).toBe("trip-summer"));
    expect(screen.getByLabelText("lodging:field.checkOut")).toHaveValue("");

    fireEvent.click(screen.getByTestId("stay-trip-dates-offer"));
    expect(screen.getByLabelText("lodging:field.checkOut")).toHaveValue("2026-07-14");
    expect(screen.queryByTestId("stay-trip-dates-offer")).not.toBeInTheDocument();
  });
});
