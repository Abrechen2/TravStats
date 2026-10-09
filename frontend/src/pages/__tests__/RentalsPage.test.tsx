import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o?.count !== undefined ? `${k}/${o.count}` : k),
    i18n: { language: "de" },
    ready: true,
  }),
}));
const addToast = vi.fn();
vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ addToast }),
}));
vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../components/ui/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/table/LogbookTabs", () => ({ default: () => null }));
vi.mock("../../components/rental/RentalFormModal", () => ({
  RentalFormModal: ({ rental }: { rental: { id: string } | null }) => (
    <div data-testid="rental-form">{rental ? rental.id : "new"}</div>
  ),
}));
vi.mock("../../components/import/DomainImportPanel", () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="rental-import" /> : null),
}));
vi.mock("../../components/import/adapters/rentalAdapter", () => ({
  useRentalImportAdapter: () => ({ domain: "rental" }),
}));
vi.mock("../../components/Training/ConfirmModal", () => ({
  default: ({
    isOpen,
    onConfirm,
    message,
    confirmButtonClass,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
    message: string;
    confirmButtonClass?: string;
  }) =>
    isOpen ? (
      <div>
        <p data-testid="confirm-message">{message}</p>
        <button type="button" onClick={onConfirm} className={confirmButtonClass}>
          confirm-delete
        </button>
      </div>
    ) : null,
}));
const listForEntry = vi.fn();
vi.mock("../../lib/api/documents", () => ({
  documentsApi: { listForEntry: (...a: unknown[]) => listForEntry(...a) },
}));

const list = vi.fn();
const remove = vi.fn();
vi.mock("../../lib/api/rental", () => ({
  rentalApi: {
    list: (...a: unknown[]) => list(...a),
    remove: (...a: unknown[]) => remove(...a),
  },
}));
const stats = vi.fn();
vi.mock("../../lib/api/rentalLinks", () => ({
  rentalLinksApi: { stats: (...a: unknown[]) => stats(...a) },
}));
const navigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

import RentalsPage from "../RentalsPage";
import { makeRental } from "../../components/rental/__tests__/rentalFixture";

const renderPage = (): void => {
  render(
    <MemoryRouter>
      <RentalsPage />
    </MemoryRouter>
  );
};

// forgejo#197: the rental logbook in the layout every logbook shares.
describe("RentalsPage", () => {
  beforeEach(() => {
    list.mockReset().mockResolvedValue({
      rentals: [makeRental({ id: "r1" })],
      total: 1,
      summary: { rentals: 1, days: 3, providers: 1 },
    });
    remove.mockReset();
    listForEntry.mockReset().mockResolvedValue([]);
    navigate.mockReset();
    addToast.mockReset();
    stats.mockReset().mockResolvedValue({
      byYear: [{ year: 2025 }, { year: 2026 }],
      providers: [{ provider: "Sixt" }, { provider: "Testcar" }],
    });
    localStorage.clear();
  });

  it("asks for one page, newest pickup first, and opens a rental from its row", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("rental-row-r1"));
    expect(navigate).toHaveBeenCalledWith("/rentals/r1");
    expect(list.mock.calls[0][0]).toMatchObject({
      sort: "pickup",
      order: "desc",
      limit: 50,
      offset: 0,
    });
    expect(screen.getByText("rental:summary.rentals/1")).toBeInTheDocument();
  });

  it("sends status, year and provider to the server", async () => {
    renderPage();
    await screen.findByTestId("rental-row-r1");
    fireEvent.change(screen.getByRole("combobox", { name: "rental:list.filterStatus" }), {
      target: { value: "cancelled" },
    });
    const year = screen.getByRole("combobox", { name: "rental:list.filterYear" });
    await waitFor(() => expect(year.querySelectorAll("option")).toHaveLength(3));
    fireEvent.change(year, { target: { value: "2025" } });
    fireEvent.click(screen.getByTestId("list-filter-more"));
    fireEvent.change(screen.getByRole("combobox", { name: "rental:list.filterProvider" }), {
      target: { value: "Sixt" },
    });
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "cancelled", year: 2025, provider: "Sixt", offset: 0 })
      )
    );
  });

  it("says a failed load instead of drawing an empty logbook", async () => {
    list.mockReset().mockRejectedValue(new Error("down"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("rental:loadError");
    expect(screen.queryByText("rental:empty")).toBeNull();
  });

  it("edits from the row's action without opening the rental", async () => {
    renderPage();
    await screen.findByTestId("rental-row-r1");
    fireEvent.click(screen.getByRole("button", { name: "rental:edit" }));
    expect(screen.getByTestId("rental-form")).toHaveTextContent("r1");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("deletes after confirmation and reloads", async () => {
    list.mockReset();
    list.mockResolvedValueOnce({
      rentals: [makeRental({ id: "r1" })],
      total: 1,
      summary: { rentals: 1, days: 3, providers: 1 },
    });
    list.mockResolvedValue({
      rentals: [],
      total: 0,
      summary: { rentals: 0, days: 0, providers: 0 },
    });
    remove.mockResolvedValue(undefined);
    renderPage();
    await screen.findByTestId("rental-row-r1");
    fireEvent.click(screen.getByRole("button", { name: "rental:delete" }));
    fireEvent.click(screen.getByText("confirm-delete"));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("r1"));
    expect(await screen.findByText("rental:empty")).toBeInTheDocument();
  });

  // forgejo#250: what goes and what stays, on a red button.
  it("names the rental, its documents and what stays before deleting", async () => {
    list.mockReset().mockResolvedValue({
      rentals: [
        makeRental({
          id: "r1",
          trip: { id: "t1", name: "Kalifornien", color: "#fff" },
          companions: ["Alex"],
        }),
      ],
      total: 1,
      summary: { rentals: 1, days: 3, providers: 1 },
    });
    listForEntry.mockResolvedValue([{ id: "d1" }, { id: "d2" }]);
    renderPage();
    await screen.findByTestId("rental-row-r1");
    fireEvent.click(screen.getByRole("button", { name: "rental:delete" }));
    await waitFor(() =>
      expect(screen.getByTestId("confirm-message").textContent).toContain(
        "documents:deleteCascadeNote/2"
      )
    );
    const message = screen.getByTestId("confirm-message").textContent ?? "";
    expect(message).toContain("rental:deleteConfirmNamed");
    expect(message).toContain("common:delete.survivors");
    expect(listForEntry).toHaveBeenCalledWith({ type: "rentalBooking", id: "r1" });
    expect(screen.getByText("confirm-delete").className).toContain("danger");
  });

  it("offers to add a rental when the logbook is empty, and only then", async () => {
    list.mockReset().mockResolvedValue({
      rentals: [],
      total: 0,
      summary: { rentals: 0, days: 0, providers: 0 },
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "rental:list.emptyAction" }));
    expect(screen.getByTestId("rental-import")).toBeInTheDocument();
  });
});
