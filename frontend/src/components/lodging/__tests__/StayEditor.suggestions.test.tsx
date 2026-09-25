import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { StayEditor } from "../StayEditor";
import { createStay, listMemberships, getFxPreview } from "../../../lib/api/lodging";
import { tripsApi } from "../../../lib/api";
import type { LodgingStay } from "../../../types/lodging";

// Same module boundary as StayEditor.test.tsx; see there for why each mock exists.
const suggestions = vi.hoisted(() => ({
  current: {
    amenities: [],
    roomAmenities: [
      { name: "Balkon", usageCount: 3 },
      { name: "Minibar", usageCount: 1 },
    ],
  },
}));
vi.mock("../../../hooks/useLodgingEntrySuggestions", () => ({
  useLodgingEntrySuggestions: () => suggestions.current,
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
});
