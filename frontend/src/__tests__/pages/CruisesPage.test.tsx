import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CruisesPage from "../../pages/CruisesPage";
import { cruiseApi } from "../../lib/api";
import type { Cruise } from "../../types";

// Heavy sibling component with its own auth/domain/pending-updates
// dependencies — irrelevant to sort/delete behaviour, stub it out.
vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-bar-stub" />,
}));

// `t` echoes the key, appending interpolated options so sort-column
// buttons (which pass `{ col: ... }`) and the delete-confirm dialog
// (which passes `{ ship: ... }`) still produce distinguishable strings.
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>): string => {
      if (options && Object.keys(options).length > 0) {
        const parts = Object.entries(options)
          .map(([k, v]) => `${k}:${String(v)}`)
          .join(",");
        return `${key}(${parts})`;
      }
      return key;
    },
    i18n: { language: "en" },
    ready: true,
  }),
}));

vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: (...args: unknown[]) => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

const mockNavigate = vi.fn();
import { MemoryRouter } from "react-router-dom";

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("../../lib/api", () => ({
  cruiseApi: {
    list: vi.fn(),
    remove: vi.fn(),
  },
}));

/**
 * Builder for a minimal Cruise fixture — the full Cruise interface has many
 * required fields irrelevant to the sort/delete tests, so we compose a
 * default and only override the bits each case cares about.
 */
const makeCruise = (overrides: Partial<Cruise> & Pick<Cruise, "id">): Cruise => ({
  userId: "u1",
  shipId: null,
  ship: null,
  shipNameOverride: "Ship",
  cruiseLine: "Line",
  routeName: null,
  departurePortId: null,
  departurePort: null,
  arrivalPortId: null,
  arrivalPort: null,
  startDate: null,
  endDate: null,
  status: "scheduled",
  color: null,
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
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("CruisesPage", () => {
  it("toggles sort order and re-orders rows when a column header is clicked", async () => {
    const early = makeCruise({
      id: "a",
      shipNameOverride: "Early Ship",
      startDate: "2026-01-10",
    });
    const late = makeCruise({
      id: "b",
      shipNameOverride: "Late Ship",
      startDate: "2026-06-10",
    });
    vi.mocked(cruiseApi.list).mockResolvedValue([early, late]);

    render(
      <MemoryRouter>
        <CruisesPage />
      </MemoryRouter>
    );

    await screen.findByRole("table");

    // Default sort is date/desc — newest (Late Ship) first.
    const rowsInitial = screen.getAllByRole("row").slice(1); // drop header row
    expect(within(rowsInitial[0]).getByText("Late Ship")).toBeInTheDocument();
    expect(within(rowsInitial[1]).getByText("Early Ship")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /columns\.dates/ }));

    // Clicking the already-active "date" header toggles to asc — oldest first.
    const rowsAfter = screen.getAllByRole("row").slice(1);
    expect(within(rowsAfter[0]).getByText("Early Ship")).toBeInTheDocument();
    expect(within(rowsAfter[1]).getByText("Late Ship")).toBeInTheDocument();
  });

  it("opens the delete-confirm dialog when a row's Delete action is clicked", async () => {
    const cruise = makeCruise({
      id: "a",
      shipNameOverride: "Solo Ship",
      startDate: "2026-01-10",
    });
    vi.mocked(cruiseApi.list).mockResolvedValue([cruise]);

    render(
      <MemoryRouter>
        <CruisesPage />
      </MemoryRouter>
    );

    await screen.findByRole("table");

    await userEvent.click(screen.getByRole("button", { name: "common:buttons.delete" }));

    const dialog = await screen.findByRole("dialog");
    // The list and the detail page share these keys now — deleting a cruise
    // used to read differently depending on which of the two you stood on.
    // `…NoStops` rather than the counted form because this fixture has none:
    // asserting WHICH key appeared proves the count branch was taken, which
    // the raw-key test harness cannot show through the rendered number.
    const message = within(dialog).getByText(/deleteConfirmMessageNoStops/);
    // …and it names the ship, which this dialog never did before.
    expect(message.textContent).toContain("Solo Ship");
  });
});
