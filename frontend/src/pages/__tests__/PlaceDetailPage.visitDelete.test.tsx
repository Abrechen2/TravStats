/**
 * Finding 3 of the write-path audit (2026-09-19). `Document.placeVisitId`
 * carries `onDelete: Cascade` — measured against the live database by
 * `backend/src/__tests__/integrity/cascades.integrity.test.ts` — and so do the
 * visit's proof photographs, whose files the route removes from disk
 * (`routes/places.ts`, `DELETE /visits/:visitId`).
 *
 * The visit row had NO confirmation at all: one click on the row's delete
 * icon, and a ticket plus every photograph of that day were gone. So this
 * suite pins two things — that the question is asked, and that it names what
 * goes with the answer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const deleteVisitMock = vi.fn();
const listForEntryMock = vi.fn();

vi.mock("../../lib/api/places", () => ({
  getPlace: vi.fn(async () => ({
    id: "p1",
    name: "Wartburg",
    category: "landmark",
    country: "DE",
    city: null,
    address: null,
    lat: 50.9661,
    lon: 10.3064,
    visited: true,
    visits: [
      {
        id: "v1",
        placeId: "p1",
        visitedAt: "2019-08-14T10:00:00.000Z",
        notes: null,
        tripId: null,
        photos: [],
      },
    ],
  })),
  createVisit: vi.fn(),
  deleteVisit: (...a: unknown[]) => deleteVisitMock(...a),
  deletePlace: vi.fn(),
}));

// The visit's documents section fetches on mount, and the network is refused
// in tests (forgejo#110). The count the dialog needs comes from the mock below.
vi.mock("../../components/documents/DocumentsSection", () => ({ default: () => null }));

vi.mock("../../lib/api/documents", () => ({
  documentsApi: { listForEntry: (...args: unknown[]) => listForEntryMock(...args) },
}));

vi.mock("../../components/places/VisitPhotoStrip", () => ({
  VisitPhotoStrip: () => <div data-testid="photo-strip-stub" />,
}));

vi.mock("../../lib/api/trips", () => ({
  tripsApi: { getAll: vi.fn(async () => []) },
}));

vi.mock("../../hooks/usePlacesVisible", () => ({
  usePlacesAccess: () => "allowed",
}));

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));

vi.mock("../../components/location/LocationMiniMap", () => ({
  LocationMiniMap: () => <div data-testid="map-stub" />,
}));

import PlaceDetailPage from "../PlaceDetailPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/places/p1"]}>
      <Routes>
        <Route path="/places/:id" element={<PlaceDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

/** The row's delete icon — the visit's, not the place's. */
async function openVisitDeleteDialog(
  user: ReturnType<typeof userEvent.setup>
): Promise<HTMLElement> {
  await screen.findByText("2019-08-14 10:00");
  const rowDeletes = screen.getAllByRole("button", { name: "common:buttons.delete" });
  await user.click(rowDeletes[0]);
  return screen.findByTestId("confirm-modal");
}

describe("PlaceDetailPage visit delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listForEntryMock.mockResolvedValue([]);
  });

  it("asks before deleting a visit, instead of acting on the first click", async () => {
    const user = userEvent.setup();
    renderPage();

    await openVisitDeleteDialog(user);

    expect(deleteVisitMock).not.toHaveBeenCalled();
  });

  it("deletes the visit once the question is answered", async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openVisitDeleteDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "common:buttons.delete" }));

    await waitFor(() => expect(deleteVisitMock).toHaveBeenCalledWith("v1"));
  });

  it("names the documents that cascade with the visit", async () => {
    listForEntryMock.mockResolvedValue([{ id: "d1" }]);
    const user = userEvent.setup();
    renderPage();

    const dialog = await openVisitDeleteDialog(user);

    await waitFor(() => expect(dialog.textContent).toContain("documents:deleteCascadeNote"));
    expect(listForEntryMock).toHaveBeenCalledWith({ type: "placeVisit", id: "v1" });
  });

  it("counts nothing until the dialog is opening", async () => {
    renderPage();

    await screen.findByText("2019-08-14 10:00");
    expect(listForEntryMock).not.toHaveBeenCalled();
  });

  it("opens at once and adds the line when the count arrives", async () => {
    let settle: (rows: { id: string }[]) => void = () => {};
    listForEntryMock.mockReturnValue(
      new Promise<{ id: string }[]>((resolve) => {
        settle = resolve;
      })
    );
    const user = userEvent.setup();
    renderPage();

    const dialog = await openVisitDeleteDialog(user);
    expect(dialog.textContent).toContain("places:detail.visitDeleteMessage");
    expect(dialog.textContent).not.toContain("documents:deleteCascadeNote");

    settle([{ id: "d1" }, { id: "d2" }]);
    await waitFor(() => expect(dialog.textContent).toContain("documents:deleteCascadeNote"));
  });

  it("keeps the base sentence when the count cannot be had", async () => {
    listForEntryMock.mockRejectedValue(new Error("Network Error"));
    const user = userEvent.setup();
    renderPage();

    const dialog = await openVisitDeleteDialog(user);

    await waitFor(() => expect(listForEntryMock).toHaveBeenCalled());
    expect(dialog.textContent).toContain("places:detail.visitDeleteMessage");
    expect(dialog.textContent).not.toContain("documents:deleteCascadeNote");
  });
});
