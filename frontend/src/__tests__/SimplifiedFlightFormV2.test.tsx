import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SimplifiedFlightFormV2 from "../components/SimplifiedFlightFormV2";
import { companionsApi } from "../lib/api";

vi.mock("../lib/api");
vi.mock("../store/settingsStore", () => ({
  useSettingsStore: vi.fn().mockReturnValue({
    features: { enableCostTracking: true },
    units: { distanceUnit: "kilometers" },
    defaults: {
      flightStatus: "scheduled",
      seatClass: "economy",
      favoriteAirline: "",
      flightCategory: "business",
    },
  }),
}));
vi.mock("../lib/geo", () => ({
  calculateDistance: vi.fn().mockReturnValue(1000),
}));
vi.mock("../lib/timeEstimation", () => ({
  storeHistoricalFlightTime: vi.fn(),
  estimateFlightTimes: vi.fn().mockReturnValue({
    arrivalTime: "14:00",
    source: "heuristic",
    confidence: "low",
  }),
}));

// TripSelectField fetches the trip list on mount from `lib/api/trips` — a
// different module than the `lib/api` barrel, so a barrel mock never covered it
// and the request escaped to the network (forgejo#110). An empty list is what a
// failed request already produced, so the assertions below are unchanged.
vi.mock("@/lib/api/trips", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/trips")>();
  return { ...actual, tripsApi: { ...actual.tripsApi, getAll: vi.fn().mockResolvedValue([]) } };
});

describe("SimplifiedFlightFormV2", () => {
  const mockOnSubmit = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // CompanionPicker (rendered on the "complete" step) fetches suggestions
    // via companionsApi.list() on mount — the bare `vi.mock("../lib/api")`
    // above auto-mocks every export to a vi.fn() returning undefined, which
    // makes CompanionPicker's `.then()` throw. Give it a resolvable promise.
    vi.mocked(companionsApi.list).mockResolvedValue([]);
  });

  it("should render flight form", () => {
    render(<SimplifiedFlightFormV2 onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    expect(screen.getByText(/flights:form\.title/i)).toBeInTheDocument();
  });

  // #289 painted the page behind the form solid black; since the CT106
  // design-6 recheck (R01) the form sits in the shared dialog frame, whose
  // scrim is a token. What must hold is that it IS a dialog: named, modal,
  // holding focus, and closing on Escape without anything else answering.
  it("is a modal dialog that takes focus and closes on Escape (R01)", () => {
    render(<SimplifiedFlightFormV2 onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    const dialog = screen.getByRole("dialog", { name: /flights:form\.title/i });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.closest(".ts-dialog-scrim")).not.toBeNull();
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(mockOnCancel).toHaveBeenCalledTimes(1);
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it("offers a close control in the header, not only below the fold (R01)", () => {
    render(<SimplifiedFlightFormV2 onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /common:buttons\.close/i }));
    expect(mockOnCancel).toHaveBeenCalledTimes(1);
  });

  it("should show error when airports are missing", async () => {
    render(<SimplifiedFlightFormV2 onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Navigate to complete step via manual entry action
    const skipButton = screen.getByText(/flights:form\.manualEntryAction/i);
    fireEvent.click(skipButton);

    await waitFor(() => {
      // Anchor on $ to match flights:form.submit and exclude submitAndReturn,
      // which was added when "Save + add return flight" got its own button.
      const submitButton = screen.getByRole("button", { name: /flights:form\.submit$/i });
      expect(submitButton).toBeDisabled();
    });
  });

  it("should validate required fields", async () => {
    render(<SimplifiedFlightFormV2 onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    const skipButton = screen.getByText(/flights:form\.manualEntryAction/i);
    fireEvent.click(skipButton);

    await waitFor(() => {
      // Anchor on $ to match flights:form.submit and exclude submitAndReturn,
      // which was added when "Save + add return flight" got its own button.
      const submitButton = screen.getByRole("button", { name: /flights:form\.submit$/i });
      expect(submitButton).toBeInTheDocument();
      // Button should be disabled when airports are missing
      expect(submitButton).toBeDisabled();
    });
  });

  /**
   * Measured in the browser on the public beta (2.7.0-beta.8): clicking
   * "Suche ueberspringen und manuell eingeben" landed on the manual step with
   * the red "Bitte waehle Start- und Zielflughafen aus" banner ALREADY
   * showing, before the user had touched a single field. The form opened by
   * telling the user off for not having filled in a form they had not seen.
   *
   * The banner was derived from state (`step === "complete" && no airports`),
   * not from a refused save, so it could not be anything else: entering the
   * step IS that state. Since forgejo#88 point 9 the same fact is carried by
   * the asterisks, which are honest about it — they describe the field, they
   * do not accuse. The error belongs to a submit that was refused.
   */
  it("shows no error on the manual step until a save is actually attempted", async () => {
    render(<SimplifiedFlightFormV2 onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    fireEvent.click(screen.getByText(/flights:form\.manualEntryAction/i));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /flights:form\.submit$/i })).toBeInTheDocument();
    });

    expect(screen.queryByText(/errors:missingAirports/i)).not.toBeInTheDocument();

    // The marks ARE there from the first render — that was the decision, and
    // it is what makes the silent banner redundant rather than merely rude.
    // Queried off the document, not the render container: the form lives in
    // the shared Modal, which portals.
    const marked = Array.from(document.querySelectorAll("label")).filter((label) =>
      label.textContent?.trim().endsWith("*")
    );
    expect(marked.length).toBeGreaterThanOrEqual(2);
  });

  /** ...and the refusal still says what is missing once the user submits.
   *  Both footer buttons are disabled while the airports are empty, so the
   *  submit that reaches the refusal is the one the form itself dispatches —
   *  Enter in any input. */
  it("names the missing airports once a submit is attempted", async () => {
    render(<SimplifiedFlightFormV2 onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    fireEvent.click(screen.getByText(/flights:form\.manualEntryAction/i));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /flights:form\.submit$/i })).toBeInTheDocument();
    });

    const form = document.querySelector("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(screen.getByText(/errors:missingAirports/i)).toBeInTheDocument();
    });
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });
});
