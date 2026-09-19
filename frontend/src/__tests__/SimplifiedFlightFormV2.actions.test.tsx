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
vi.mock("../lib/geo", () => ({ calculateDistance: vi.fn().mockReturnValue(1000) }));
vi.mock("../lib/timeEstimation", () => ({
  storeHistoricalFlightTime: vi.fn(),
  estimateFlightTimes: vi.fn().mockReturnValue({
    arrivalTime: "14:00",
    source: "heuristic",
    confidence: "low",
  }),
}));
vi.mock("@/lib/api/trips", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/trips")>();
  return { ...actual, tripsApi: { ...actual.tripsApi, getAll: vi.fn().mockResolvedValue([]) } };
});

// EmailImportTab fetches `/parser-capabilities` through `lib/api/client` --
// a different module than the `lib/api` barrel mocked above, so the request
// escaped to the real network and then failed whichever test happened to be
// running when it landed. Same shape as the trips mock above (forgejo#110).
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  const stub = (): Promise<{ data: Record<string, never> }> => Promise.resolve({ data: {} });
  return {
    ...actual,
    api: {
      get: vi.fn(stub),
      post: vi.fn(stub),
      put: vi.fn(stub),
      patch: vi.fn(stub),
      delete: vi.fn(stub),
    },
  };
});

/**
 * forgejo#88, point 9 — which action the footer offers first, and what a
 * refused save does.
 *
 * The owner's complaint was that "Speichern + Rückflug anlegen" read as the
 * main action. It does not: "Flug speichern" is the rightmost button and the
 * only `btn-primary` one. That is already true — this file is what keeps it
 * true, because nothing else measures the ORDER, and a footer is exactly the
 * kind of thing a later change reflows without noticing.
 *
 * The focus case is the new behaviour. A save the form refuses used to answer
 * with one sentence at the top that named no field; now the cursor lands in
 * the first empty required control, which on a form this long is the
 * difference between reading an error and fixing one.
 */
const openManualEntry = async (): Promise<void> => {
  render(<SimplifiedFlightFormV2 onSubmit={vi.fn()} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByText(/flights:form\.manualEntryAction/i));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /flights:form\.submit$/i })).toBeInTheDocument()
  );
};

describe("SimplifiedFlightFormV2 — the footer's actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    vi.mocked(companionsApi.list).mockResolvedValue([]);
  });

  it("puts 'Flug speichern' last and makes it the only primary action", async () => {
    await openManualEntry();

    const labels = screen
      .getAllByRole("button")
      .map((button) => button.textContent ?? "")
      .filter((label) => label.startsWith("flights:form."));

    expect(labels).toEqual([
      "flights:form.cancel",
      "flights:form.submitAndReturn",
      "flights:form.submit",
    ]);

    const save = screen.getByRole("button", { name: /flights:form\.submit$/i });
    const withReturn = screen.getByRole("button", { name: /flights:form\.submitAndReturn/i });
    expect(save.className).toContain("btn-primary");
    expect(withReturn.className).toContain("btn-secondary");
    expect(withReturn.className).not.toContain("btn-primary");
  });

  it("focuses the first empty required field when the form refuses to save", async () => {
    await openManualEntry();

    // Enter in any input reaches the form's own submit handler.
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);

    await waitFor(() => {
      const focused = document.activeElement as HTMLElement | null;
      expect(focused).not.toBeNull();
      // The departure airport: first required control in reading order.
      expect(focused?.tagName).toBe("INPUT");
      expect(focused?.getAttribute("placeholder")).toBe(
        "flights:form.placeholders.departureAirport"
      );
    });
  });

  /**
   * The route the beta audit of 2026-09-19 found unreachable (forgejo#88 P9,
   * third point): both save BUTTONS were disabled while a required field was
   * empty, so the focus-the-gap behaviour above could only be triggered by
   * pressing Enter in an input -- which is not what a user who clicks Save
   * does. Both buttons now reach it.
   */
  it("focuses the first empty required field from the save-and-return button", async () => {
    await openManualEntry();

    fireEvent.click(screen.getByRole("button", { name: /flights:form\.submitAndReturn/i }));

    await waitFor(() => {
      const focused = document.activeElement as HTMLElement | null;
      expect(focused?.getAttribute("placeholder")).toBe(
        "flights:form.placeholders.departureAirport"
      );
    });
  });

  /**
   * The primary button is asserted through its ASSOCIATION, not a click:
   * jsdom does not submit a form for a submit button that is tied to it by
   * the `form` attribute (the button lives in the dialog footer, outside the
   * <form>), so a click here would measure jsdom rather than the app. What a
   * browser needs is exactly the two things below -- an enabled submit button
   * pointing at the form -- and the form's own submit path is pinned above.
   */
  it("leaves the primary save button enabled and tied to the form", async () => {
    await openManualEntry();

    const save = screen.getByRole("button", { name: /flights:form\.submit$/i });
    const form = screen.getByRole("dialog").querySelector("form");
    expect(save).toBeEnabled();
    expect(save.getAttribute("type")).toBe("submit");
    expect(save.getAttribute("form")).toBe(form?.getAttribute("id"));
  });

  /**
   * The case the focus fix exists for, and the one it silently failed at
   * first: `focus()` on a control inside a closed `<details>` is a NO-OP. With
   * the core folded — which the session remembers, so this is not an exotic
   * state — the old code moved nothing and the user got the same nameless
   * error as before.
   */
  it("unfolds a closed group to reach the field that is missing", async () => {
    await openManualEntry();

    const core = document.querySelector('details[data-section="core"]') as HTMLDetailsElement;
    fireEvent.click(core.querySelector("summary")!);
    await waitFor(() => expect(core.open).toBe(false));

    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);

    await waitFor(() => expect(core.open).toBe(true));
    expect((document.activeElement as HTMLElement | null)?.getAttribute("placeholder")).toBe(
      "flights:form.placeholders.departureAirport"
    );
    // And the unfold is remembered, exactly as a click on the heading is.
    expect(window.sessionStorage.getItem("travstats.flightForm.section.core")).toBe("open");
  });
});
