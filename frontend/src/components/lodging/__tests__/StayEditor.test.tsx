import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StayEditor } from "../StayEditor";
import { createStay, updateStay, listMemberships, getFxPreview } from "../../../lib/api/lodging";
import { tripsApi } from "../../../lib/api";
import { logger } from "../../../lib/logger";
import type { LodgingStay } from "../../../types/lodging";

// Mocked at the resolved-module level — StayEditor.tsx imports the same
// "../../lib/api/lodging" file (this test lives 3 dirs under src, matching
// the 3-level "../../../lib/api/lodging" specifier here).
vi.mock("../../../lib/api/lodging", () => ({
  createStay: vi.fn(),
  updateStay: vi.fn(),
  listMemberships: vi.fn(),
  getFxPreview: vi.fn(),
}));

vi.mock("../../../lib/api", () => ({
  tripsApi: { getAll: vi.fn() },
}));

const baseStay: LodgingStay = {
  id: "stay-1",
  lodgingId: "lodging-1",
  userId: "user-1",
  tripId: null,
  bookingId: null,
  checkIn: "2026-07-11T00:00:00.000Z",
  checkOut: "2026-07-12T00:00:00.000Z",
  status: "completed",
  roomNumber: null,
  roomCategory: null,
  board: "none",
  pricePerNight: null,
  currency: "EUR",
  totalPrice: null,
  totalPriceBase: null,
  fxRate: null,
  fxRateDate: null,
  fxBaseCurrency: null,
  isAwardStay: true,
  ratingRoom: null,
  ratingBreakfast: null,
  ratingService: null,
  ratingOverall: null,
  roomAmenities: [],
  bookingReference: null,
  membershipId: null,
  receiptUrl: null,
  companions: [],
  notes: null,
  parserTemplate: null,
  parserConfidence: null,
  dataSource: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("StayEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listMemberships).mockResolvedValue([]);
    vi.mocked(tripsApi.getAll).mockResolvedValue([]);
    vi.mocked(getFxPreview).mockResolvedValue(null);
  });

  // (a) FX readout: totalPrice=420 CHF against base EUR (the global
  // settingsStore mock in src/__tests__/setup.ts fixes baseCurrency to
  // "EUR") must render a readout once price + currency + check-in are all set.
  it("shows a live FX readout once totalPrice=420, currency=CHF, and check-in are set (base EUR)", async () => {
    vi.mocked(getFxPreview).mockResolvedValue({
      baseAmount: 391.23,
      rate: 0.9315,
      rateDate: "2026-07-11",
      baseCurrency: "EUR",
    });

    render(<StayEditor mode="create" lodgingId="lodging-1" onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("lodging:field.checkIn"), {
      target: { value: "2026-07-11" },
    });
    fireEvent.change(screen.getByLabelText("lodging:field.totalPrice"), {
      target: { value: "420" },
    });
    await userEvent.selectOptions(screen.getByLabelText("lodging:field.currency"), "CHF");

    const readout = await screen.findByTestId("stay-editor-fx-readout", undefined, { timeout: 2000 });
    expect(readout.textContent).toContain("→");
    expect(readout.textContent).toContain("0.9315");
    expect(readout.textContent).not.toMatch(/null|NaN|undefined/);

    // The preview call must ask for exactly what the user entered, and
    // never resolve to the authoritative save-time snapshot on its own.
    await waitFor(() => {
      expect(getFxPreview).toHaveBeenCalledWith(420, "CHF", "2026-07-11");
    });
  });

  it("renders no FX readout when the preview lookup fails (never a broken/guessed value)", async () => {
    vi.mocked(getFxPreview).mockResolvedValue(null);

    render(<StayEditor mode="create" lodgingId="lodging-1" onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("lodging:field.checkIn"), {
      target: { value: "2026-07-11" },
    });
    fireEvent.change(screen.getByLabelText("lodging:field.totalPrice"), {
      target: { value: "420" },
    });
    await userEvent.selectOptions(screen.getByLabelText("lodging:field.currency"), "CHF");

    await waitFor(() => expect(getFxPreview).toHaveBeenCalled());
    expect(screen.queryByTestId("stay-editor-fx-readout")).not.toBeInTheDocument();
  });

  it("does not query the FX preview when the currency already equals the base currency", async () => {
    render(<StayEditor mode="create" lodgingId="lodging-1" onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("lodging:field.checkIn"), {
      target: { value: "2026-07-11" },
    });
    fireEvent.change(screen.getByLabelText("lodging:field.totalPrice"), {
      target: { value: "150" },
    });
    // currency defaults to EUR == base currency

    await new Promise((r) => setTimeout(r, 500));
    expect(getFxPreview).not.toHaveBeenCalled();
    expect(screen.queryByTestId("stay-editor-fx-readout")).not.toBeInTheDocument();
  });

  // (b) award-stay toggle: MUST reach the submitted payload — this is the
  // exact wiring the four POINTS_PRO_* achievements depend on.
  it("includes isAwardStay=true in the create payload when the toggle is checked", async () => {
    vi.mocked(createStay).mockResolvedValue({ ...baseStay, id: "new-stay" });
    const onSaved = vi.fn();

    render(<StayEditor mode="create" lodgingId="lodging-1" onClose={vi.fn()} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText("lodging:field.checkIn"), {
      target: { value: "2026-07-11" },
    });
    fireEvent.change(screen.getByLabelText("lodging:field.checkOut"), {
      target: { value: "2026-07-12" },
    });

    await userEvent.click(screen.getByTestId("award-stay-toggle"));
    await userEvent.click(screen.getByTestId("stay-editor-save"));

    await waitFor(() => expect(createStay).toHaveBeenCalled());
    const [calledLodgingId, payload] = vi.mocked(createStay).mock.calls[0];
    expect(calledLodgingId).toBe("lodging-1");
    expect(payload.isAwardStay).toBe(true);
    // Dates must carry an explicit UTC offset ("Z") — never a bare
    // "YYYY-MM-DDTHH:mm:ss" — so the backend's `new Date(v).toISOString()`
    // normalization in schemas/lodging.ts cannot reinterpret the picked
    // check-in as server-local time and shift it to a different calendar day.
    expect(payload.checkIn).toBe("2026-07-11T00:00:00.000Z");
    expect(payload.checkOut).toBe("2026-07-12T00:00:00.000Z");
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "new-stay" }));
  });

  it("un-checking an existing award stay sends isAwardStay=false on update (not just omitted)", async () => {
    vi.mocked(updateStay).mockResolvedValue({ ...baseStay, isAwardStay: false });

    render(
      <StayEditor
        mode="edit"
        lodgingId="lodging-1"
        stay={baseStay}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    // baseStay.isAwardStay is true — the checkbox must start checked.
    const toggle = screen.getByTestId("award-stay-toggle") as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    await userEvent.click(toggle);
    await userEvent.click(screen.getByTestId("stay-editor-save"));

    await waitFor(() => expect(updateStay).toHaveBeenCalled());
    const [, , payload] = vi.mocked(updateStay).mock.calls[0];
    expect(payload.isAwardStay).toBe(false);
  });

  it("shows a save error and does not call onSaved when checkIn/checkOut are missing", async () => {
    const onSaved = vi.fn();
    render(<StayEditor mode="create" lodgingId="lodging-1" onClose={vi.fn()} onSaved={onSaved} />);

    await userEvent.click(screen.getByTestId("stay-editor-save"));

    expect(await screen.findByTestId("stay-editor-error")).toBeInTheDocument();
    expect(createStay).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  // Guards against a caller bug (edit mode without the entity to edit) —
  // must surface as a clean, handled error rather than reaching an unsafe
  // cast past a possibly-absent `stay` (`(stay as LodgingStay).id`). Note:
  // the surrounding try/catch already swallows the resulting TypeError and
  // shows the same generic message, so `stay-editor-error` alone can't tell
  // an explicit guard apart from an accidentally-caught crash — the
  // `logger.error` assertion below is what actually distinguishes them (a
  // real guard returns before ever entering the catch/log path).
  it("shows a save error and never calls updateStay or logs a crash when mode='edit' has no stay", async () => {
    const onSaved = vi.fn();
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    render(
      <StayEditor
        mode="edit"
        lodgingId="lodging-1"
        stay={null}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    fireEvent.change(screen.getByLabelText("lodging:field.checkIn"), {
      target: { value: "2026-07-11" },
    });
    fireEvent.change(screen.getByLabelText("lodging:field.checkOut"), {
      target: { value: "2026-07-12" },
    });

    await userEvent.click(screen.getByTestId("stay-editor-save"));

    expect(await screen.findByTestId("stay-editor-error")).toBeInTheDocument();
    expect(updateStay).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    // The explicit guard returns before the try/catch — no crash is ever
    // caught-and-logged. Without the guard, the unsafe cast throws inside
    // the try block and `logger.error("StayEditor: save failed", ...)` fires.
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
