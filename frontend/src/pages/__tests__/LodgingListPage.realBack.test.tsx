import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Lodging } from "../../types/lodging";

/**
 * Owner report 2026-11-23: "← Logbuch · Unterkünfte" reopened the list at the
 * top, on page 1, with the filters gone. Back is a real Back now — the list
 * state lives in the URL and the scroll is kept per history entry.
 */

const listLodgingPageMock = vi.fn();

vi.mock("../../lib/api/lodging", () => ({
  listLodgingPage: (...args: unknown[]) => listLodgingPageMock(...args),
  getLodgingFacets: vi.fn().mockResolvedValue({
    countries: [],
    years: [],
    types: [],
    statuses: [],
    summary: { lodgings: 0, stays: 0, nights: 0, chains: 0 },
  }),
  getLodgingStats: vi.fn().mockResolvedValue(null),
  deleteLodging: vi.fn(),
  getLodgingDeleteFacts: vi.fn().mockResolvedValue({ photoCount: 0, documentCount: 0 }),
  listStayPage: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
}));
vi.mock("../../lib/api/documents", () => ({
  documentsApi: { listForEntry: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  tripsApi: { getAll: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../../lib/api/loyalty", () => ({ getLoyaltyMembership: vi.fn() }));
vi.mock("../../lib/api/lodgingImport", () => ({
  listLodgingImportBatches: vi.fn().mockResolvedValue([]),
  revertLodgingImportBatch: vi.fn(),
}));
vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
vi.mock("../../components/lodging/LodgingFormModal", () => ({ LodgingFormModal: () => null }));
vi.unmock("../../store/settingsStore");

import LodgingListPage from "../LodgingListPage";
import DetailHeader from "../../components/ui/DetailHeader";
import NavigationMemory from "../../components/navigation/NavigationMemory";
import { resetNavHistory } from "../../lib/navigation/navHistory";
import { resetScrollMemory } from "../../lib/navigation/scrollMemory";

vi.setConfig({ testTimeout: 20_000 });

function lodging(id: string, name: string): Lodging {
  return {
    id,
    userId: "user-1",
    type: "hotel",
    name,
    chainId: null,
    chain: null,
    address: null,
    city: "Ludwigsburg",
    country: "DE",
    isoCountryCode: null,
    lat: 48.9,
    lon: 9.19,
    stars: 4,
    amenities: [],
    visited: true,
    notes: null,
    dataSource: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    stays: [],
    overallRating: null,
    stayCount: 1,
    nights: 2,
    totalSpendBase: null,
    totalSpendBaseByCurrency: {},
  } as unknown as Lodging;
}

function Where(): JSX.Element {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

function DetailStub(): JSX.Element {
  return (
    <DetailHeader
      backTo="/lodging"
      backLabel="Logbuch · Unterkünfte"
      domain="lodging"
      icon="H"
      title="Hotel"
    />
  );
}

function renderApp(entries: string[]): void {
  render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <NavigationMemory />
      <Where />
      <Routes>
        <Route path="/lodging" element={<LodgingListPage />} />
        <Route path="/lodging/:id" element={<DetailStub />} />
      </Routes>
    </MemoryRouter>
  );
}

let scrollY = 0;
const scrollTo = vi.fn((x: number | ScrollToOptions, y?: number) => {
  scrollY = typeof x === "number" ? (y ?? 0) : (x.top ?? 0);
});

describe("Lodging list — a real Back", () => {
  beforeEach(() => {
    resetNavHistory();
    resetScrollMemory();
    listLodgingPageMock.mockReset();
    listLodgingPageMock.mockResolvedValue({
      rows: [lodging("l-51", "Hotel Einundfünfzig")],
      total: 120,
    });
    scrollY = 0;
    scrollTo.mockClear();
    vi.stubGlobal("scrollTo", scrollTo);
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      get: () => 6000,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("back from a lodging restores the page, the filters and the scroll of the list", async () => {
    const user = userEvent.setup();
    renderApp(["/lodging?status=completed&page=2"]);

    // Page 2 under the status filter is what the list asks for — not page 1, all stays.
    await waitFor(() =>
      expect(listLodgingPageMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "completed", offset: 50 })
      )
    );
    const row = await screen.findByText("Hotel Einundfünfzig");

    // The reader scrolls down the list, then opens the stay.
    scrollY = 1400;
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    await user.click(row);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/lodging/l-51"));
    expect(scrollTo).toHaveBeenCalledWith(0, 0);

    listLodgingPageMock.mockClear();
    scrollTo.mockClear();
    await user.click(screen.getByRole("link", { name: /Logbuch · Unterkünfte/ }));

    expect(screen.getByTestId("where")).toHaveTextContent("/lodging?status=completed&page=2");
    await waitFor(() =>
      expect(listLodgingPageMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: "completed", offset: 50 })
      )
    );
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 1400));
  });

  it("a deep link with nothing behind it falls back to the list's URL", async () => {
    const user = userEvent.setup();
    renderApp(["/lodging/l-51"]);
    await user.click(screen.getByRole("link", { name: /Logbuch · Unterkünfte/ }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/lodging$/);
  });

  it("filters survive a reload: they are read from the URL and written back to it", async () => {
    renderApp(["/lodging?status=scheduled&year=2024&q=Adlon"]);
    await waitFor(() =>
      expect(listLodgingPageMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "scheduled", year: 2024, search: "Adlon" })
      )
    );
    expect(screen.getByDisplayValue("Adlon")).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("Adlon"), { target: { value: "Sacher" } });
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent(
        "/lodging?status=scheduled&year=2024&q=Sacher"
      )
    );
  });
});

describe("NavigationMemory — an entry made by a filter change keeps its scroll", () => {
  beforeEach(() => {
    resetNavHistory();
    resetScrollMemory();
    listLodgingPageMock.mockReset();
    listLodgingPageMock.mockResolvedValue({
      rows: [lodging("l-51", "Hotel Einundfünfzig")],
      total: 120,
    });
    scrollY = 0;
    scrollTo.mockClear();
    vi.stubGlobal("scrollTo", scrollTo);
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      get: () => 6000,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a filter written after the last scroll still comes back at that scroll", async () => {
    const user = userEvent.setup();
    renderApp(["/lodging?q=Adlon"]);
    await screen.findByText("Hotel Einundfünfzig");
    scrollY = 900;
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    // A filter change REPLACES the entry (new key) without any scroll event.
    fireEvent.change(screen.getByDisplayValue("Adlon"), { target: { value: "Sacher" } });
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("q=Sacher"));

    await user.click(screen.getByText("Hotel Einundfünfzig"));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/lodging/l-51"));
    scrollTo.mockClear();
    await user.click(screen.getByRole("link", { name: /Logbuch · Unterkünfte/ }));
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 900));
  });
});
