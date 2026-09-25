import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { StayEditor } from "../StayEditor";
import { createStay, listMemberships, getFxPreview } from "../../../lib/api/lodging";
import { tripsApi } from "../../../lib/api";
import type { LodgingStay } from "../../../types/lodging";

// Same module boundary as StayEditor.test.tsx; see there for why each mock exists.
const suggestions = vi.hoisted(() => ({
  askedFor: [] as Array<string | undefined>,
  current: {
    amenities: [],
    roomAmenities: [
      { name: "Balkon", usageCount: 3 },
      { name: "Minibar", usageCount: 1 },
    ],
    roomNumbers: ["412", "12"],
    roomCategories: ["Deluxe", "Suite"],
    boards: ["half", "breakfast"],
  },
}));
vi.mock("../../../hooks/useLodgingEntrySuggestions", () => ({
  useLodgingEntrySuggestions: (lodgingId?: string) => {
    suggestions.askedFor.push(lodgingId);
    return suggestions.current;
  },
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

/** The editor loads memberships and trips on mount; let both land inside act. */
async function renderCreate(): Promise<void> {
  render(<StayEditor mode="create" lodgingId="lodging-1" onClose={vi.fn()} onSaved={vi.fn()} />);
  await act(async () => {});
}

async function fillDates(): Promise<void> {
  fireEvent.change(screen.getByLabelText("lodging:field.checkIn"), {
    target: { value: "2026-05-01" },
  });
  fireEvent.change(screen.getByLabelText("lodging:field.checkOut"), {
    target: { value: "2026-05-03" },
  });
}

async function saved(): Promise<Parameters<typeof createStay>[1]> {
  await userEvent.click(screen.getByTestId("stay-editor-save"));
  await waitFor(() => expect(createStay).toHaveBeenCalled());
  return vi.mocked(createStay).mock.calls[0][1];
}

describe("StayEditor — suggestions from the user's own stays", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listMemberships).mockResolvedValue([]);
    vi.mocked(tripsApi.getAll).mockResolvedValue([]);
    vi.mocked(getFxPreview).mockResolvedValue(null);
    vi.mocked(createStay).mockResolvedValue({ id: "stay-1" } as LodgingStay);
  });

  it("room amenities are chips, with the ones recorded before on offer", async () => {
    await renderCreate();
    await fillDates();
    await userEvent.type(screen.getByLabelText("lodging:field.roomAmenities"), "bal");
    fireEvent.mouseDown(screen.getByRole("option", { name: /Balkon/ }));
    await userEvent.type(screen.getByLabelText("lodging:field.roomAmenities"), "Meerblick{Enter}");

    expect((await saved()).roomAmenities).toEqual(["Balkon", "Meerblick"]);
  });

  it("offers this house's rooms and the usual categories as one-click chips", async () => {
    await renderCreate();
    expect(suggestions.askedFor).toContain("lodging-1");
    await fillDates();
    const room = screen.getByLabelText("lodging:field.room") as HTMLInputElement;
    await userEvent.type(room, "4");
    // Narrowed to what continues the typed text.
    expect(screen.queryByText("12", { selector: "button" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("412", { selector: "button" }));
    await userEvent.click(screen.getByText("Suite", { selector: "button" }));

    expect(await saved()).toMatchObject({ roomNumber: "412", roomCategory: "Suite" });
  });

  it("offers the usual board on a new stay, never writes it", async () => {
    await renderCreate();
    await fillDates();
    const offer = screen.getByRole("button", { name: /lodging:stayEditor.boardSuggestion/ });
    await userEvent.click(offer);
    expect(screen.getByRole("button", { name: "lodging:board.half" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    // A chosen board makes the offer disappear.
    expect(
      screen.queryByRole("button", { name: /lodging:stayEditor.boardSuggestion/ })
    ).not.toBeInTheDocument();
    expect((await saved()).board).toBe("half");
  });

  it("does not offer a board on an existing stay that recorded none", async () => {
    render(
      <StayEditor
        mode="edit"
        lodgingId="lodging-1"
        stay={{ id: "stay-1", board: "none", roomAmenities: [] } as unknown as LodgingStay}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    await act(async () => {});
    expect(
      screen.queryByRole("button", { name: /lodging:stayEditor.boardSuggestion/ })
    ).not.toBeInTheDocument();
  });
});
