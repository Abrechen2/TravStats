import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
vi.mock("../../components/common/TripPhotoWindowStrip", () => ({ default: () => null }));
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

const FX = {
  price: 300,
  currency: "USD",
  priceBase: 275,
  fxRate: 0.917,
  fxRateDate: "2026-03-12",
  fxBaseCurrency: "EUR",
  fxSource: "ecb",
};

// forgejo#393: stored on the booking, shown nowhere until now.
describe("RentalDetailPage — stored data", () => {
  beforeEach(() => get.mockReset());

  it("shows who operates the rental, the broker reference, the agreement number and the FX snapshot", async () => {
    get.mockResolvedValue(
      makeRental({
        id: "r1",
        operatedBy: "Sixt Franchise Nord",
        broker: "Holiday Autos",
        brokerReference: "HA-998877",
        agreementNumber: "RA-5544",
        ...FX,
      })
    );
    renderPage();
    expect(await screen.findByText("Sixt Franchise Nord")).toBeInTheDocument();
    expect(screen.getByText("HA-998877")).toBeInTheDocument();
    expect(screen.getByText("RA-5544")).toBeInTheDocument();
    expect(screen.getByText("common:fx.label")).toBeInTheDocument();
    expect(screen.getByText(/→.*common:fx\.ecb/)).toBeInTheDocument();
  });

  it("draws no reference section and no FX row when none of it is stored", async () => {
    get.mockResolvedValue(
      makeRental({
        id: "r1",
        operatedBy: null,
        broker: null,
        brokerReference: null,
        agreementNumber: null,
        price: null,
      })
    );
    renderPage();
    await screen.findByTestId("rental-detail-status");
    expect(screen.queryByText("rental:detail.reference")).toBeNull();
    expect(screen.queryByText("common:fx.label")).toBeNull();
  });
});
