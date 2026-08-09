import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StayEditor } from "../StayEditor";
import { createStay, updateStay, listMemberships, getFxPreview } from "../../../lib/api/lodging";
import { tripsApi } from "../../../lib/api";
import { logger } from "../../../lib/logger";
import type { LodgingStay, LodgingMembership } from "../../../types/lodging";

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
  membershipOptOut: false,
  receiptUrl: null,
  companions: [],
  notes: null,
  parserTemplate: null,
  parserConfidence: null,
  dataSource: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const baseMembership: LodgingMembership = {
  id: "m-0",
  userId: "user-1",
  programName: "Test Programme",
  membershipNumber: null,
  tier: null,
  chainIds: [],
  chains: [],
  lodgingIds: [],
  lodgings: [],
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

  // Finding 4: an emptied field must send an explicit `null`, not `undefined`
  // (which JSON.stringify drops, reading back on the backend as "unchanged").
  it("sends null (not undefined) for a cleared roomNumber/totalPrice/notes on edit", async () => {
    vi.mocked(updateStay).mockResolvedValue({ ...baseStay });
    const filledStay: LodgingStay = {
      ...baseStay,
      roomNumber: "204",
      totalPrice: 150,
      notes: "Old notes",
    };

    render(
      <StayEditor
        mode="edit"
        lodgingId="lodging-1"
        stay={filledStay}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("lodging:field.room"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("lodging:field.totalPrice"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("lodging:field.notes"), { target: { value: "" } });

    await userEvent.click(screen.getByTestId("stay-editor-save"));

    await waitFor(() => expect(updateStay).toHaveBeenCalled());
    const [, , payload] = vi.mocked(updateStay).mock.calls[0];
    expect(payload.roomNumber).toBeNull();
    expect(payload.totalPrice).toBeNull();
    expect(payload.notes).toBeNull();
    expect(payload.roomNumber).not.toBeUndefined();
    expect(payload.totalPrice).not.toBeUndefined();
    expect(payload.notes).not.toBeUndefined();
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

  // Alex, Discord 2026-07-12: the overall score should follow the three
  // category scores instead of being typed a fourth time.
  it("derives ratingOverall from the three category ratings and persists it", async () => {
    vi.mocked(createStay).mockResolvedValue({ ...baseStay, id: "new-stay" });

    render(<StayEditor mode="create" lodgingId="lodging-1" onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("lodging:field.checkIn"), {
      target: { value: "2026-07-11" },
    });
    fireEvent.change(screen.getByLabelText("lodging:field.checkOut"), {
      target: { value: "2026-07-12" },
    });

    // 5 + 4 + 3 = 12 / 3 = 4
    await userEvent.click(screen.getByTestId("star-room-5"));
    await userEvent.click(screen.getByTestId("star-breakfast-4"));
    await userEvent.click(screen.getByTestId("star-service-3"));

    // Shown before saving, so the user can see what will be stored.
    expect(screen.getByTestId("stay-editor-overall").textContent).toContain("4");

    await userEvent.click(screen.getByTestId("stay-editor-save"));

    await waitFor(() => expect(createStay).toHaveBeenCalled());
    expect(vi.mocked(createStay).mock.calls[0][1].ratingOverall).toBe(4);
  });

  it("keeps an imported overall that has no component ratings behind it", async () => {
    // An import (or a legacy row) can carry an overall score with no room/
    // breakfast/service behind it. Deriving from the components alone made
    // the editor show "—" and send null, so merely opening such a stay and
    // saving it wiped the user's own number.
    const importedStay: LodgingStay = { ...baseStay, ratingOverall: 4 };
    vi.mocked(updateStay).mockResolvedValue(importedStay);

    render(
      <StayEditor
        mode="edit"
        lodgingId="lodging-1"
        stay={importedStay}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect(screen.getByTestId("stay-editor-overall").textContent).toContain("4");

    await userEvent.click(screen.getByTestId("stay-editor-save"));

    await waitFor(() => expect(updateStay).toHaveBeenCalled());
    expect(vi.mocked(updateStay).mock.calls[0][2].ratingOverall).toBe(4);
  });

  it("lets a newly typed component rating override an imported overall", async () => {
    const importedStay: LodgingStay = { ...baseStay, ratingOverall: 2 };
    vi.mocked(updateStay).mockResolvedValue(importedStay);

    render(
      <StayEditor
        mode="edit"
        lodgingId="lodging-1"
        stay={importedStay}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await userEvent.click(screen.getByTestId("star-room-5"));
    expect(screen.getByTestId("stay-editor-overall").textContent).toContain("5");

    await userEvent.click(screen.getByTestId("stay-editor-save"));

    await waitFor(() => expect(updateStay).toHaveBeenCalled());
    expect(vi.mocked(updateStay).mock.calls[0][2].ratingOverall).toBe(5);
  });

  it("offers no overall-rating picker — the value is read-only", () => {
    render(<StayEditor mode="create" lodgingId="lodging-1" onClose={vi.fn()} onSaved={vi.fn()} />);

    // The three category pickers exist…
    expect(screen.getByTestId("star-room-5")).toBeInTheDocument();
    // …but the fourth one is gone; nothing can set the overall by hand.
    expect(screen.queryByTestId("star-overall-5")).not.toBeInTheDocument();
  });

  // Same message: price per night was a second hand-typed number that could
  // silently contradict the total.
  it("derives pricePerNight from total ÷ nights and persists it", async () => {
    vi.mocked(createStay).mockResolvedValue({ ...baseStay, id: "new-stay" });

    render(<StayEditor mode="create" lodgingId="lodging-1" onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("lodging:field.checkIn"), {
      target: { value: "2026-07-11" },
    });
    fireEvent.change(screen.getByLabelText("lodging:field.checkOut"), {
      target: { value: "2026-07-14" },
    });
    fireEvent.change(screen.getByLabelText("lodging:field.totalPrice"), {
      target: { value: "600" },
    });

    // 600 over three nights — visible before saving.
    expect(screen.getByTestId("stay-editor-price-per-night").textContent).toContain("200");

    await userEvent.click(screen.getByTestId("stay-editor-save"));

    await waitFor(() => expect(createStay).toHaveBeenCalled());
    expect(vi.mocked(createStay).mock.calls[0][1].pricePerNight).toBe(200);
  });

  // Alex's sixth ask, the one that spans every domain: status follows the
  // dates, and only "cancelled" stays a manual choice.
  it("offers no status dropdown — only a cancelled checkbox", () => {
    render(<StayEditor mode="create" lodgingId="lodging-1" onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByTestId("stay-cancelled-toggle")).toBeInTheDocument();
    expect(screen.queryByLabelText("lodging:field.status")).not.toBeInTheDocument();
  });

  it("shows the status the dates imply, and sends it on save", async () => {
    vi.mocked(createStay).mockResolvedValue({ ...baseStay, id: "new-stay" });

    render(<StayEditor mode="create" lodgingId="lodging-1" onClose={vi.fn()} onSaved={vi.fn()} />);

    // A stay that ended in the past.
    fireEvent.change(screen.getByLabelText("lodging:field.checkIn"), {
      target: { value: "2020-05-01" },
    });
    fireEvent.change(screen.getByLabelText("lodging:field.checkOut"), {
      target: { value: "2020-05-04" },
    });
    expect(screen.getByTestId("stay-derived-status").textContent).toContain(
      "lodging:stayStatus.completed"
    );

    // Move it into the future and the derived value follows.
    fireEvent.change(screen.getByLabelText("lodging:field.checkIn"), {
      target: { value: "2099-05-01" },
    });
    fireEvent.change(screen.getByLabelText("lodging:field.checkOut"), {
      target: { value: "2099-05-04" },
    });
    expect(screen.getByTestId("stay-derived-status").textContent).toContain(
      "lodging:stayStatus.scheduled"
    );

    await userEvent.click(screen.getByTestId("stay-editor-save"));

    await waitFor(() => expect(createStay).toHaveBeenCalled());
    expect(vi.mocked(createStay).mock.calls[0][1].status).toBe("scheduled");
  });

  it("ticking cancelled overrides the derived status and hides the derived readout", async () => {
    vi.mocked(createStay).mockResolvedValue({ ...baseStay, id: "new-stay" });

    render(<StayEditor mode="create" lodgingId="lodging-1" onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("lodging:field.checkIn"), {
      target: { value: "2020-05-01" },
    });
    fireEvent.change(screen.getByLabelText("lodging:field.checkOut"), {
      target: { value: "2020-05-04" },
    });

    await userEvent.click(screen.getByTestId("stay-cancelled-toggle"));
    expect(screen.queryByTestId("stay-derived-status")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("stay-editor-save"));

    await waitFor(() => expect(createStay).toHaveBeenCalled());
    expect(vi.mocked(createStay).mock.calls[0][1].status).toBe("cancelled");
  });

  it("un-ticking cancelled falls back to the derived status, not to a stale value", async () => {
    vi.mocked(createStay).mockResolvedValue({ ...baseStay, id: "new-stay" });

    render(<StayEditor mode="create" lodgingId="lodging-1" onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("lodging:field.checkIn"), {
      target: { value: "2020-05-01" },
    });
    fireEvent.change(screen.getByLabelText("lodging:field.checkOut"), {
      target: { value: "2020-05-04" },
    });

    const toggle = screen.getByTestId("stay-cancelled-toggle");
    await userEvent.click(toggle);
    await userEvent.click(toggle);

    await userEvent.click(screen.getByTestId("stay-editor-save"));

    await waitFor(() => expect(createStay).toHaveBeenCalled());
    expect(vi.mocked(createStay).mock.calls[0][1].status).toBe("completed");
  });

  it("sends a null pricePerNight for a same-day stay instead of dividing by zero", async () => {
    vi.mocked(createStay).mockResolvedValue({ ...baseStay, id: "new-stay" });

    render(<StayEditor mode="create" lodgingId="lodging-1" onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("lodging:field.checkIn"), {
      target: { value: "2026-07-11" },
    });
    fireEvent.change(screen.getByLabelText("lodging:field.checkOut"), {
      target: { value: "2026-07-11" },
    });
    fireEvent.change(screen.getByLabelText("lodging:field.totalPrice"), {
      target: { value: "120" },
    });

    await userEvent.click(screen.getByTestId("stay-editor-save"));

    await waitFor(() => expect(createStay).toHaveBeenCalled());
    const payload = vi.mocked(createStay).mock.calls[0][1];
    expect(payload.pricePerNight).toBeNull();
    // The total itself is untouched — only the derived rate is unknowable.
    expect(payload.totalPrice).toBe(120);
  });

  it("shows the card that covers the hotel's chain, without asking", async () => {
    vi.mocked(listMemberships).mockResolvedValue([
      {
        ...baseMembership,
        id: "m-1",
        programName: "Minor DISCOVERY",
        chainIds: [7],
        lodgingIds: [],
      },
    ]);

    render(
      <StayEditor
        mode="edit"
        lodgingId="lodging-1"
        lodgingChainId={7}
        stay={baseStay}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect(await screen.findByTestId("stay-editor-membership")).toHaveTextContent(
      "Minor DISCOVERY"
    );
    // The mount that created chain-less orphan programmes is gone.
    expect(screen.queryByText("lodging:stayEditor.manageMemberships")).not.toBeInTheDocument();
  });

  it("sends no override when the derived card is accepted as-is", async () => {
    vi.mocked(listMemberships).mockResolvedValue([
      { ...baseMembership, id: "m-1", chainIds: [7], lodgingIds: [] },
    ]);
    vi.mocked(updateStay).mockResolvedValue(baseStay);

    render(
      <StayEditor
        mode="edit"
        lodgingId="lodging-1"
        lodgingChainId={7}
        stay={baseStay}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    await screen.findByTestId("stay-editor-membership");
    await userEvent.click(screen.getByTestId("stay-editor-save"));

    await waitFor(() => expect(updateStay).toHaveBeenCalled());
    const payload = vi.mocked(updateStay).mock.calls[0][2];
    expect(payload.membershipId).toBeNull();
    expect(payload.membershipOptOut).toBe(false);
  });

  it("records an explicit 'no programme' distinctly from 'derive it'", async () => {
    vi.mocked(listMemberships).mockResolvedValue([
      { ...baseMembership, id: "m-1", chainIds: [7], lodgingIds: [] },
    ]);
    vi.mocked(updateStay).mockResolvedValue(baseStay);

    render(
      <StayEditor
        mode="edit"
        lodgingId="lodging-1"
        lodgingChainId={7}
        stay={baseStay}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    await screen.findByTestId("stay-editor-membership");
    await userEvent.click(screen.getByTestId("stay-editor-membership-override-toggle"));
    await userEvent.selectOptions(screen.getByTestId("stay-editor-membership-select"), "__none__");
    await userEvent.click(screen.getByTestId("stay-editor-save"));

    await waitFor(() => expect(updateStay).toHaveBeenCalled());
    const payload = vi.mocked(updateStay).mock.calls[0][2];
    expect(payload.membershipOptOut).toBe(true);
    expect(payload.membershipId).toBeNull();
  });
});
