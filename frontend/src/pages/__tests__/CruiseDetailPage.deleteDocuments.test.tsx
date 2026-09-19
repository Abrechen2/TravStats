/**
 * Finding 3 of the write-path audit (2026-09-19): `Document.cruiseId` carries
 * `onDelete: Cascade` — measured against the live database by
 * `backend/src/__tests__/integrity/cascades.integrity.test.ts` — so deleting a
 * cruise deletes the booking confirmation filed with it. The dialog named the
 * ship and the port calls and stopped there.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Cruise } from "../../types";

const getMock = vi.fn();
const listForEntryMock = vi.fn();

// Stubbed for the same reason the price suite stubs it: the section fetches on
// mount, and the network is refused in tests (forgejo#110). The count the
// dialog needs comes from the mock below, not from the section.
vi.mock("../../components/documents/DocumentsSection", () => ({ default: () => null }));

vi.mock("../../lib/api/documents", () => ({
  documentsApi: { listForEntry: (...args: unknown[]) => listForEntryMock(...args) },
}));

vi.mock("../../lib/api", () => ({
  cruiseApi: {
    get: (...args: unknown[]) => getMock(...args),
    remove: vi.fn(),
  },
}));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: "de" },
  }),
}));

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));

vi.mock("../../components/Cruise/CruiseRouteMap", () => ({
  CruiseRouteMap: () => <div data-testid="map-stub" />,
}));

vi.mock("../../components/Cruise/CruiseEditModal", () => ({
  CruiseEditModal: () => null,
}));

import CruiseDetailPage from "../CruiseDetailPage";

function makeCruise(): Cruise {
  return {
    id: "cruise-1",
    userId: "user-1",
    shipId: null,
    ship: null,
    shipNameOverride: "AIDAnova",
    cruiseLine: "AIDA",
    routeName: null,
    departurePortId: null,
    departurePort: null,
    arrivalPortId: null,
    arrivalPort: null,
    startDate: "2024-05-13T00:00:00.000Z",
    endDate: "2024-05-20T00:00:00.000Z",
    status: "flown",
    cabinNumber: null,
    cabinType: null,
    deck: null,
    bookingReference: null,
    price: null,
    currency: null,
    notes: null,
    tags: [],
    companions: [],
    tripId: null,
    bookingId: null,
    stops: [],
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

async function renderCruise(): Promise<void> {
  getMock.mockResolvedValue(makeCruise());
  render(
    <MemoryRouter initialEntries={["/cruises/cruise-1"]}>
      <Routes>
        <Route path="/cruises/:id" element={<CruiseDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByText("AIDAnova");
}

describe("CruiseDetailPage delete dialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listForEntryMock.mockResolvedValue([]);
  });

  it("names the documents that cascade with the cruise", async () => {
    listForEntryMock.mockResolvedValue([{ id: "d1" }]);
    const user = userEvent.setup();
    await renderCruise();

    await user.click(screen.getByRole("button", { name: "detail.delete" }));

    const dialog = await screen.findByTestId("confirm-modal");
    await waitFor(() => expect(dialog.textContent).toContain("documents:deleteCascadeNote"));
    expect(listForEntryMock).toHaveBeenCalledWith({ type: "cruise", id: "cruise-1" });
  });

  it("counts nothing until the dialog is opening", async () => {
    await renderCruise();

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
    await renderCruise();

    await user.click(screen.getByRole("button", { name: "detail.delete" }));

    const dialog = await screen.findByTestId("confirm-modal");
    expect(dialog.textContent).toContain("detail.deleteConfirmMessageNoStops");
    expect(dialog.textContent).not.toContain("documents:deleteCascadeNote");

    settle([{ id: "d1" }, { id: "d2" }]);
    await waitFor(() => expect(dialog.textContent).toContain("documents:deleteCascadeNote"));
  });

  it("keeps the base sentence when the count cannot be had", async () => {
    listForEntryMock.mockRejectedValue(new Error("Network Error"));
    const user = userEvent.setup();
    await renderCruise();

    await user.click(screen.getByRole("button", { name: "detail.delete" }));

    const dialog = await screen.findByTestId("confirm-modal");
    await waitFor(() => expect(listForEntryMock).toHaveBeenCalled());
    expect(dialog.textContent).toContain("detail.deleteConfirmMessageNoStops");
    expect(dialog.textContent).not.toContain("documents:deleteCascadeNote");
  });
});
