/**
 * The stay editor on the shared Modal with the shared form blocks
 * (forgejo#245-#249). Before: a hand-rolled overlay with no Escape, no focus
 * trap and no scroll lock; a banner at the foot of a long form for a missing
 * date; Escape / Cancel dropped a half-typed stay without a word; a price field
 * that was only a placeholder; and a rate explanation reachable by hover only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StayEditor } from "../StayEditor";
import { createStay, updateStay, listMemberships, getFxPreview } from "../../../lib/api/lodging";
import { tripsApi } from "../../../lib/api";
import type { LodgingStay } from "../../../types/lodging";

vi.mock("../../../hooks/useLodgingEntrySuggestions", () => ({
  useLodgingEntrySuggestions: () => ({
    amenities: [],
    roomAmenities: [],
    roomNumbers: [],
    roomCategories: [],
    boards: [],
  }),
}));
vi.mock("../../documents/DocumentsSection", () => ({ default: () => null }));
vi.mock("../../../lib/api/lodging", () => ({
  createStay: vi.fn(),
  updateStay: vi.fn(),
  listMemberships: vi.fn(),
  getFxPreview: vi.fn(),
}));
vi.mock("../../../lib/api", () => ({ tripsApi: { getAll: vi.fn() } }));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock("@/hooks/useRecentCurrencies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useRecentCurrencies")>();
  return { ...actual, useRecentCurrencies: () => [] };
});

const stored = {
  id: "stay-9",
  lodgingId: "lodging-1",
  checkIn: "2026-07-11T00:00:00.000Z",
  checkOut: "2026-07-12T00:00:00.000Z",
} as unknown as LodgingStay;

const existing = {
  id: "stay-1",
  lodgingId: "lodging-1",
  userId: "user-1",
  tripId: null,
  bookingId: null,
  checkInTime: null,
  checkOutTime: null,
  checkIn: "2026-07-11T00:00:00.000Z",
  checkOut: "2026-07-12T00:00:00.000Z",
  datePrecision: "DAY",
  nights: null,
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
  fxSource: null,
  isAwardStay: false,
  ratingRoom: null,
  ratingBreakfast: null,
  ratingService: null,
  ratingOverall: null,
  roomAmenities: [],
  bookingReference: null,
  membershipId: null,
  membershipOptOut: false,
  receiptUrl: null,
  guests: null,
  companions: [],
  notes: null,
  parserTemplate: null,
  parserConfidence: null,
  dataSource: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as LodgingStay;

const networkError = Object.assign(new Error("Network Error"), { isAxiosError: true });
const checkIn = (): HTMLElement => screen.getByLabelText(/^lodging:field\.checkIn\b/);
const checkOut = (): HTMLElement => screen.getByLabelText(/^lodging:field\.checkOut\b/);

type EditorProps = React.ComponentProps<typeof StayEditor>;

/** Render and let the mount-time loads (trips, memberships) settle inside act. */
async function renderEditor(props: Partial<EditorProps> = {}): Promise<void> {
  await act(async () => {
    render(
      <StayEditor
        mode="create"
        lodgingId="lodging-1"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        {...props}
      />
    );
  });
}

async function fillDates(): Promise<void> {
  fireEvent.change(checkIn(), { target: { value: "2026-07-11" } });
  fireEvent.change(checkOut(), { target: { value: "2026-07-12" } });
}

describe("StayEditor - the shared form blocks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listMemberships).mockResolvedValue([]);
    vi.mocked(tripsApi.getAll).mockResolvedValue([]);
    vi.mocked(getFxPreview).mockResolvedValue(null);
  });

  it("is a real dialog now: named by its title, closing on Escape when nothing changed", async () => {
    const onClose = vi.fn();
    await renderEditor({ lodgingName: "Hotel Adlon", onClose });
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName(/lodging:stayEditor\.createTitle/);
    // The house is named in the dialog, so a stay opened from a list of stays
    // says which house it belongs to.
    expect(screen.getByTestId("stay-editor-house")).toHaveTextContent("Hotel Adlon");

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("discard-question")).toBeNull();
  });

  it("asks before discarding a changed stay - Escape and Cancel alike", async () => {
    const onClose = vi.fn();
    await renderEditor({ onClose });
    await userEvent.type(screen.getByLabelText("lodging:field.bookingReference"), "AB12");

    await userEvent.keyboard("{Escape}");
    expect(screen.getByTestId("discard-question")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "common:discard.keepEditing" }));
    await userEvent.click(screen.getByRole("button", { name: "common:buttons.cancel" }));
    expect(screen.getByTestId("discard-question")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "common:discard.confirm" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("an edit that opens and closes untouched does not ask", async () => {
    const onClose = vi.fn();
    await renderEditor({ mode: "edit", stay: existing, onClose });
    await userEvent.click(screen.getByRole("button", { name: "common:buttons.cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft on a failed save, offers a retry for a network drop, and sends once more only on retry", async () => {
    vi.mocked(createStay).mockRejectedValueOnce(networkError).mockResolvedValueOnce(stored);
    const onSaved = vi.fn();
    await renderEditor({ onSaved });
    await userEvent.type(screen.getByLabelText("lodging:field.bookingReference"), "AB12");
    await fillDates();

    await userEvent.click(screen.getByTestId("stay-editor-save"));
    const banner = await screen.findByText("common:saveErrors.network");
    expect(banner.closest("[role=alert]")).toHaveFocus();
    expect(screen.getByLabelText("lodging:field.bookingReference")).toHaveValue("AB12");
    expect(onSaved).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(stored));
    expect(createStay).toHaveBeenCalledTimes(2);
  });

  it("the failure notice goes away with the next edit", async () => {
    vi.mocked(createStay).mockRejectedValueOnce(networkError);
    await renderEditor();
    await fillDates();
    await userEvent.click(screen.getByTestId("stay-editor-save"));
    await screen.findByText("common:saveErrors.network");

    await userEvent.type(screen.getByLabelText("lodging:field.bookingReference"), "x");
    expect(screen.queryByText("common:saveErrors.network")).toBeNull();
  });

  it("a stored stay whose follow-up fails says so and cannot be created twice", async () => {
    vi.mocked(createStay).mockResolvedValue(stored);
    const onSaved = vi.fn().mockRejectedValue(new Error("reload failed"));
    await renderEditor({ onSaved });
    await fillDates();

    await userEvent.click(screen.getByTestId("stay-editor-save"));
    expect(await screen.findByText("common:form.savedButViewRefreshFailed")).toBeInTheDocument();
    expect(screen.queryByTestId("stay-editor-save")).toBeNull();
    expect(createStay).toHaveBeenCalledTimes(1);
  });

  it("a double click sends one request", async () => {
    let resolve: (stay: LodgingStay) => void = () => undefined;
    vi.mocked(createStay).mockReturnValue(new Promise((res) => (resolve = res)));
    await renderEditor();
    await fillDates();

    const save = screen.getByTestId("stay-editor-save");
    fireEvent.click(save);
    fireEvent.click(save);
    expect(createStay).toHaveBeenCalledTimes(1);
    await act(async () => resolve(stored));
  });

  it("an edit save goes through updateStay with the stay's id", async () => {
    vi.mocked(updateStay).mockResolvedValue(stored);
    await renderEditor({ mode: "edit", stay: existing });
    await userEvent.type(screen.getByLabelText("lodging:field.bookingReference"), "AB12");
    await userEvent.click(screen.getByTestId("stay-editor-save"));
    await waitFor(() =>
      expect(updateStay).toHaveBeenCalledWith("lodging-1", "stay-1", expect.anything())
    );
  });

  it("the price has a visible label, not just a placeholder", async () => {
    await renderEditor();
    const price = screen.getByLabelText("lodging:field.totalPrice");
    expect(price).not.toHaveAttribute("placeholder");
    expect(screen.getByText("lodging:field.totalPrice").tagName).toBe("LABEL");
    expect(screen.getByLabelText("lodging:field.currency")).toBeInTheDocument();
  });

  it("explains the exchange rate through a button, not a hover-only title", async () => {
    vi.mocked(getFxPreview).mockResolvedValue({
      baseAmount: 391.23,
      rate: 0.9315,
      rateDate: "2026-07-11",
      baseCurrency: "EUR",
      source: "ecb",
    });
    await renderEditor({ mode: "edit", stay: { ...existing, totalPrice: 420, currency: "CHF" } });
    const readout = await screen.findByTestId("stay-editor-fx-readout");
    expect(readout).not.toHaveAttribute("title");
    const help = readout.querySelector("button");
    expect(help).not.toBeNull();
    await userEvent.click(help as HTMLElement);
    expect(await screen.findByText("lodging:fx.tooltip")).toBeInTheDocument();
  });
});
