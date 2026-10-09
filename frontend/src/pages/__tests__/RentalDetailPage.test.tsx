import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o?.count !== undefined ? `${k}/${o.count}` : k),
    i18n: { language: "de" },
    ready: true,
  }),
}));
vi.mock("../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("../../components/ui/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/documents/DocumentsSection", () => ({
  default: ({ rentalCategories }: { rentalCategories?: boolean }) => (
    <div data-testid="documents" data-categories={String(Boolean(rentalCategories))} />
  ),
}));
vi.mock("../../components/rental/RentalRouteMap", () => ({ RentalRouteMap: () => null }));
vi.mock("../../components/rental/RentalSuggestionBanner", () => ({
  RentalSuggestionBanner: () => null,
}));
vi.mock("../../components/rental/RentalFormModal", () => ({
  RentalFormModal: ({ initialStep }: { initialStep?: string }) => (
    <div data-testid="rental-form">{initialStep ?? "default"}</div>
  ),
}));
vi.mock("../../components/Training/ConfirmModal", () => ({
  default: ({ isOpen, message }: { isOpen: boolean; message: string }) =>
    isOpen ? <p data-testid="confirm-message">{message}</p> : null,
}));
vi.mock("../../lib/api/documents", () => ({
  documentsApi: { listForEntry: vi.fn().mockResolvedValue([]) },
}));
const get = vi.fn();
vi.mock("../../lib/api/rental", () => ({ rentalApi: { get: (...a: unknown[]) => get(...a) } }));

import RentalDetailPage from "../RentalDetailPage";
import { makeRental } from "../../components/rental/__tests__/rentalFixture";

const renderPage = (): void => {
  render(
    <MemoryRouter initialEntries={["/rentals/r1"]}>
      <Routes>
        <Route path="/rentals/:id" element={<RentalDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
};

describe("RentalDetailPage", () => {
  beforeEach(() => get.mockReset());

  // forgejo#240
  it("shows the return card while the car is out, and opens the form at its return step", async () => {
    get.mockResolvedValue(makeRental({ id: "r1", status: "in_progress" }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "rental:returnCard.record" }));
    expect(screen.getByTestId("rental-form").textContent).toBe("return");
  });

  it("shows no return card once the rental is completed", async () => {
    get.mockResolvedValue(makeRental({ id: "r1", status: "completed" }));
    renderPage();
    await screen.findByTestId("rental-detail-status");
    expect(screen.queryByTestId("rental-return-card")).toBeNull();
  });

  // forgejo#239, #250
  it("files the documents by category and names what stays when deleting", async () => {
    get.mockResolvedValue(
      makeRental({
        id: "r1",
        status: "completed",
        trip: { id: "t", name: "Bayern", color: "#fff" },
      })
    );
    renderPage();
    expect((await screen.findByTestId("documents")).dataset.categories).toBe("true");
    // The document count is asked when the question opens; let it settle.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "rental:delete" }));
    });
    const message = screen.getByTestId("confirm-message").textContent ?? "";
    expect(message).toContain("rental:deleteConfirmNamed");
    expect(message).toContain("common:delete.survivors");
  });
});
