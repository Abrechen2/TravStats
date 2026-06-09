import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DetectReviewModal from "../../../components/Trips/DetectReviewModal";
import type { ProposedTrip } from "../../../lib/api/trips";
import enTrips from "../../../i18n/resources/en/trips.json";

/** Resolve a "trips:detectReview.expandLegs"-style key against the real EN bundle. */
function resolveEn(key: string): string | undefined {
  const path = key.replace(/^trips:/, "").split(".");
  let node: unknown = enTrips;
  for (const seg of path) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  return typeof node === "string" ? node : undefined;
}

vi.mock("../../../lib/api", () => ({
  tripsApi: { detect: vi.fn().mockResolvedValue({ created: [], orphansRemoved: 0 }) },
}));

vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: () => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const fromBundle = resolveEn(key);
      if (fromBundle) return fromBundle;
      return typeof options?.defaultValue === "string" ? (options.defaultValue as string) : key;
    },
    i18n: { language: "en" },
    ready: true,
  }),
}));

function makeProposal(overrides: Partial<ProposedTrip> = {}): ProposedTrip {
  return {
    source: "pnr",
    flightIds: ["f1", "f2"],
    pnr: "ABC123",
    origin: "FRA",
    destination: "JFK",
    span: { from: "2024-01-01", to: "2024-01-10" },
    suggestedName: "FRA → JFK",
    legs: [
      { date: "2024-01-01", flightNumber: "LH400", depIata: "FRA", arrIata: "JFK", status: "flown" },
      { date: "2024-01-10", flightNumber: null, depIata: "JFK", arrIata: "FRA", status: "scheduled" },
    ],
    ...overrides,
  };
}

function renderModal(proposals: ProposedTrip[]): void {
  render(<DetectReviewModal proposals={proposals} onClose={vi.fn()} onCommitted={vi.fn()} />);
}

describe("DetectReviewModal", () => {
  it("hides legs by default and reveals them when the expander is clicked", async () => {
    renderModal([makeProposal()]);

    // Collapsed: leg detail not in the DOM.
    expect(screen.queryByText("LH400")).not.toBeInTheDocument();

    const expander = screen.getByRole("button", { name: /show flights/i });
    expect(expander).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(expander);

    // Expanded: both legs render, null flightNumber falls back to "—".
    expect(screen.getByText("LH400")).toBeInTheDocument();
    expect(screen.getByText("FRA → JFK")).toBeInTheDocument();
    expect(screen.getByText("JFK → FRA")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /hide flights/i })
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("does not render an expander when the proposal has no legs", () => {
    renderModal([makeProposal({ legs: [] })]);
    expect(screen.queryByRole("button", { name: /show flights/i })).not.toBeInTheDocument();
  });

  it("toggling expansion does not flip the selection checkbox", async () => {
    renderModal([makeProposal()]);
    const checkbox = screen.getAllByRole("checkbox")[1]; // [0] = select-all header toggle
    expect(checkbox).toHaveAttribute("aria-checked", "true");

    await userEvent.click(screen.getByRole("button", { name: /show flights/i }));

    // Legs revealed, selection untouched.
    expect(screen.getByText("LH400")).toBeInTheDocument();
    expect(checkbox).toHaveAttribute("aria-checked", "true");
  });

  it("toggling the checkbox does not expand the card", async () => {
    renderModal([makeProposal()]);
    const checkbox = screen.getAllByRole("checkbox")[1];

    await userEvent.click(checkbox);

    expect(checkbox).toHaveAttribute("aria-checked", "false");
    // Still collapsed — no legs rendered.
    expect(screen.queryByText("LH400")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /show flights/i })
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("supports multiple cards expanded at once", async () => {
    const a = makeProposal({ flightIds: ["a1", "a2"], legs: [
      { date: "2024-02-01", flightNumber: "BA111", depIata: "LHR", arrIata: "CDG", status: "flown" },
    ] });
    const b = makeProposal({ flightIds: ["b1", "b2"], legs: [
      { date: "2024-03-01", flightNumber: "AF222", depIata: "CDG", arrIata: "LHR", status: "cancelled" },
    ] });
    renderModal([a, b]);

    const expanders = screen.getAllByRole("button", { name: /show flights/i });
    await userEvent.click(expanders[0]);
    await userEvent.click(expanders[1]);

    expect(screen.getByText("BA111")).toBeInTheDocument();
    expect(screen.getByText("AF222")).toBeInTheDocument();
  });

  it("renders a status chip per leg", async () => {
    renderModal([makeProposal()]);
    await userEvent.click(screen.getByRole("button", { name: /show flights/i }));
    const list = screen.getByText("LH400").closest("ul");
    expect(list).not.toBeNull();
    const rows = within(list as HTMLElement).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText(/flown/i)).toBeInTheDocument();
    expect(within(rows[1]).getByText(/scheduled/i)).toBeInTheDocument();
  });
});
