/**
 * The overlap notice behind saving a stay (forgejo#229), which is also the
 * duplicate warning for "stay here again" (forgejo#227): a question with
 * "Absichtlich so", never a block; cancelled stays and a hand-over day are not
 * overlaps; the exact rule is `shared/lodgingOverlap.ts`, tested on its own.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StayEditor } from "../StayEditor";
import {
  createStay,
  updateStay,
  listMemberships,
  getFxPreview,
  listStayPage,
} from "../../../lib/api/lodging";
import { tripsApi } from "../../../lib/api";
import type { LodgingStay, LodgingStayListItem } from "../../../types/lodging";
import { getNamed } from "../../../__tests__/helpers/namedElement";

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
  listStayPage: vi.fn(),
}));
vi.mock("../../../lib/api", () => ({ tripsApi: { getAll: vi.fn() } }));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock("@/hooks/useRecentCurrencies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useRecentCurrencies")>();
  return { ...actual, useRecentCurrencies: () => [] };
});

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

const created = { id: "stay-new" } as unknown as LodgingStay;

/** A stored stay of ANOTHER (or the same) house, as GET /lodging/stays serves it. */
function storedStay(
  over: Partial<LodgingStayListItem> & { id: string; checkIn: string; checkOut: string }
): LodgingStayListItem {
  return {
    ...existing,
    lodging: {
      id: "house-other",
      name: "Ibis Mitte",
      type: "hotel",
      city: "Berlin",
      country: "DE",
      chainId: null,
      isoCountryCode: "DE",
    },
    trip: null,
    lodgingId: "house-other",
    ...over,
  } as LodgingStayListItem;
}

const checkInField = (): HTMLElement => screen.getByLabelText(/^lodging:field\.checkIn\b/);
const checkOutField = (): HTMLElement => screen.getByLabelText(/^lodging:field\.checkOut\b/);
const notice = (): HTMLElement | null => screen.queryByTestId("stay-conflict-notice");

type EditorProps = React.ComponentProps<typeof StayEditor>;

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

function typeDates(from: string, to: string): void {
  fireEvent.change(checkInField(), { target: { value: from } });
  fireEvent.change(checkOutField(), { target: { value: to } });
}

describe("StayEditor - the overlap notice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listMemberships).mockResolvedValue([]);
    vi.mocked(tripsApi.getAll).mockResolvedValue([]);
    vi.mocked(getFxPreview).mockResolvedValue(null);
    vi.mocked(listStayPage).mockResolvedValue({ rows: [], total: 0 });
    vi.mocked(createStay).mockResolvedValue(created);
    vi.mocked(updateStay).mockResolvedValue(created);
  });

  it("asks the server for the stays touching the dates, and saves at once when none collide", async () => {
    await renderEditor();
    typeDates("2026-07-10", "2026-07-14");
    await userEvent.click(screen.getByTestId("stay-editor-save"));

    await waitFor(() => expect(createStay).toHaveBeenCalledTimes(1));
    expect(listStayPage).toHaveBeenCalledWith(
      expect.objectContaining({ from: "2026-07-10", to: "2026-07-14" })
    );
    expect(notice()).toBeNull();
  });

  it("shows the colliding stay with its house and period, sends nothing, and takes focus", async () => {
    vi.mocked(listStayPage).mockResolvedValue({
      rows: [
        storedStay({
          id: "other",
          checkIn: "2026-07-12T00:00:00.000Z",
          checkOut: "2026-07-16T00:00:00.000Z",
        }),
      ],
      total: 1,
    });
    await renderEditor();
    typeDates("2026-07-10", "2026-07-14");
    await userEvent.click(screen.getByTestId("stay-editor-save"));

    const box = await screen.findByTestId("stay-conflict-notice");
    expect(box).toHaveFocus();
    expect(box).toHaveTextContent("lodging:conflict.title");
    expect(screen.getByTestId("stay-conflict-other")).toHaveTextContent("Ibis Mitte");
    expect(createStay).not.toHaveBeenCalled();
  });

  it('"Absichtlich so" saves, once, and the question is not asked again for those dates', async () => {
    vi.mocked(listStayPage).mockResolvedValue({
      rows: [
        storedStay({
          id: "other",
          checkIn: "2026-07-12T00:00:00.000Z",
          checkOut: "2026-07-16T00:00:00.000Z",
        }),
      ],
      total: 1,
    });
    const onSaved = vi.fn();
    await renderEditor({ onSaved });
    typeDates("2026-07-10", "2026-07-14");
    await userEvent.click(screen.getByTestId("stay-editor-save"));
    await screen.findByTestId("stay-conflict-notice");

    await userEvent.click(screen.getByTestId("stay-conflict-proceed"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
    expect(createStay).toHaveBeenCalledTimes(1);
  });

  it("a check-out and a check-in on the same day are a hand-over, not an overlap", async () => {
    vi.mocked(listStayPage).mockResolvedValue({
      rows: [
        storedStay({
          id: "before",
          checkIn: "2026-07-05T00:00:00.000Z",
          checkOut: "2026-07-10T00:00:00.000Z",
        }),
        storedStay({
          id: "after",
          checkIn: "2026-07-14T00:00:00.000Z",
          checkOut: "2026-07-18T00:00:00.000Z",
        }),
      ],
      total: 2,
    });
    await renderEditor();
    typeDates("2026-07-10", "2026-07-14");
    await userEvent.click(screen.getByTestId("stay-editor-save"));

    await waitFor(() => expect(createStay).toHaveBeenCalledTimes(1));
    expect(notice()).toBeNull();
  });

  it("a cancelled stored stay occupies nothing", async () => {
    vi.mocked(listStayPage).mockResolvedValue({
      rows: [
        storedStay({
          id: "cancelled",
          status: "cancelled",
          checkIn: "2026-07-10T00:00:00.000Z",
          checkOut: "2026-07-14T00:00:00.000Z",
        }),
      ],
      total: 1,
    });
    await renderEditor();
    typeDates("2026-07-10", "2026-07-14");
    await userEvent.click(screen.getByTestId("stay-editor-save"));

    await waitFor(() => expect(createStay).toHaveBeenCalledTimes(1));
  });

  it("a stay of the SAME house on the same days is worded as a likely duplicate", async () => {
    vi.mocked(listStayPage).mockResolvedValue({
      rows: [
        storedStay({
          id: "twin",
          lodgingId: "lodging-1",
          lodging: {
            id: "lodging-1",
            name: "Hotel Adlon",
            type: "hotel",
            city: null,
            country: null,
            chainId: null,
            isoCountryCode: null,
          },
          checkIn: "2026-07-10T00:00:00.000Z",
          checkOut: "2026-07-14T00:00:00.000Z",
        }),
      ],
      total: 1,
    });
    await renderEditor();
    typeDates("2026-07-10", "2026-07-14");
    await userEvent.click(screen.getByTestId("stay-editor-save"));

    const box = await screen.findByTestId("stay-conflict-notice");
    expect(box).toHaveTextContent("lodging:conflict.titleDuplicate");
    expect(screen.getByTestId("stay-conflict-twin")).toHaveTextContent(
      "lodging:conflict.sameHouse"
    );
  });

  it("editing a stay never collides with its own stored self, and an untouched date is not asked about", async () => {
    vi.mocked(listStayPage).mockResolvedValue({
      rows: [
        storedStay({
          id: "stay-1",
          lodgingId: "lodging-1",
          checkIn: existing.checkIn as string,
          checkOut: existing.checkOut as string,
        }),
      ],
      total: 1,
    });
    await renderEditor({ mode: "edit", stay: existing });

    // Notes only: no lookup at all.
    await userEvent.type(screen.getByLabelText("lodging:field.bookingReference"), "AB12");
    await userEvent.click(screen.getByTestId("stay-editor-save"));
    await waitFor(() => expect(updateStay).toHaveBeenCalledTimes(1));
    expect(listStayPage).not.toHaveBeenCalled();
  });

  it("moving the dates of an edit looks again, and ignores the stay itself", async () => {
    vi.mocked(listStayPage).mockResolvedValue({
      rows: [
        storedStay({
          id: "stay-1",
          lodgingId: "lodging-1",
          checkIn: existing.checkIn as string,
          checkOut: existing.checkOut as string,
        }),
      ],
      total: 1,
    });
    await renderEditor({ mode: "edit", stay: existing });
    fireEvent.change(checkOutField(), { target: { value: "2026-07-13" } });
    await userEvent.click(screen.getByTestId("stay-editor-save"));

    await waitFor(() => expect(updateStay).toHaveBeenCalledTimes(1));
    expect(listStayPage).toHaveBeenCalledTimes(1);
    expect(notice()).toBeNull();
  });

  it("changing a date clears the notice and the next Save looks again", async () => {
    vi.mocked(listStayPage).mockResolvedValueOnce({
      rows: [
        storedStay({
          id: "other",
          checkIn: "2026-07-12T00:00:00.000Z",
          checkOut: "2026-07-16T00:00:00.000Z",
        }),
      ],
      total: 1,
    });
    await renderEditor();
    typeDates("2026-07-10", "2026-07-14");
    await userEvent.click(screen.getByTestId("stay-editor-save"));
    await screen.findByTestId("stay-conflict-notice");

    fireEvent.change(checkOutField(), { target: { value: "2026-07-11" } });
    expect(notice()).toBeNull();
    await userEvent.click(screen.getByTestId("stay-editor-save"));
    await waitFor(() => expect(createStay).toHaveBeenCalledTimes(1));
    expect(listStayPage).toHaveBeenCalledTimes(2);
  });

  it("a month-precision stay names no days and is not looked up", async () => {
    await renderEditor();
    await userEvent.selectOptions(screen.getByTestId("stay-date-precision"), "MONTH");
    fireEvent.change(checkInField(), { target: { value: "2011-07" } });
    await userEvent.click(screen.getByTestId("stay-editor-save"));

    await waitFor(() => expect(createStay).toHaveBeenCalledTimes(1));
    expect(listStayPage).not.toHaveBeenCalled();
  });

  it("a failed lookup is said, can be retried, and never silently passes for 'no overlap'", async () => {
    vi.mocked(listStayPage).mockRejectedValueOnce(new Error("offline"));
    await renderEditor();
    typeDates("2026-07-10", "2026-07-14");
    await userEvent.click(screen.getByTestId("stay-editor-save"));

    const box = await screen.findByTestId("stay-conflict-notice");
    expect(box).toHaveTextContent("lodging:conflict.unchecked");
    expect(createStay).not.toHaveBeenCalled();

    await userEvent.click(getNamed("button", "lodging:conflict.retry"));
    await waitFor(() => expect(createStay).toHaveBeenCalledTimes(1));
    expect(listStayPage).toHaveBeenCalledTimes(2);
  });

  it("after a failed lookup the user can still save anyway", async () => {
    vi.mocked(listStayPage).mockRejectedValue(new Error("offline"));
    await renderEditor();
    typeDates("2026-07-10", "2026-07-14");
    await userEvent.click(screen.getByTestId("stay-editor-save"));
    await screen.findByTestId("stay-conflict-notice");

    await userEvent.click(screen.getByTestId("stay-conflict-proceed"));
    await waitFor(() => expect(createStay).toHaveBeenCalledTimes(1));
  });

  // forgejo#229 review: the lookup used to read the first 100 and ignore `total`,
  // so a stay beyond them was never compared.
  describe("a crowded window", () => {
    const filler = (n: number, offset: number): LodgingStayListItem[] =>
      Array.from({ length: n }, (_, i) =>
        storedStay({
          id: `far-${offset + i}`,
          checkIn: "2020-01-01T00:00:00.000Z",
          checkOut: "2020-01-02T00:00:00.000Z",
        })
      );

    it("walks every page, so a collision past the first page is found", async () => {
      vi.mocked(listStayPage)
        .mockResolvedValueOnce({ rows: filler(500, 0), total: 600 })
        .mockResolvedValueOnce({
          rows: [
            ...filler(99, 500),
            storedStay({
              id: "late",
              checkIn: "2026-07-12T00:00:00.000Z",
              checkOut: "2026-07-16T00:00:00.000Z",
            }),
          ],
          total: 600,
        });
      await renderEditor();
      typeDates("2026-07-10", "2026-07-14");
      await userEvent.click(screen.getByTestId("stay-editor-save"));

      await screen.findByTestId("stay-conflict-late");
      expect(listStayPage).toHaveBeenCalledTimes(2);
      expect(vi.mocked(listStayPage).mock.calls.map(([q]) => q?.offset)).toEqual([0, 500]);
      expect(createStay).not.toHaveBeenCalled();
    });

    it("says 'not fully checked' when it could not compare everything, never a silent clear", async () => {
      vi.mocked(listStayPage)
        .mockResolvedValueOnce({ rows: filler(2, 0), total: 10 })
        .mockResolvedValueOnce({ rows: [], total: 10 });
      await renderEditor();
      typeDates("2026-07-10", "2026-07-14");
      await userEvent.click(screen.getByTestId("stay-editor-save"));

      const box = await screen.findByTestId("stay-conflict-notice");
      expect(box).toHaveTextContent("lodging:conflict.incomplete");
      expect(createStay).not.toHaveBeenCalled();

      await userEvent.click(screen.getByTestId("stay-conflict-proceed"));
      await waitFor(() => expect(createStay).toHaveBeenCalledTimes(1));
    });

    it("offers 'Erneut prüfen' on the not-fully-checked notice, and a complete second look clears it", async () => {
      vi.mocked(listStayPage)
        .mockResolvedValueOnce({ rows: filler(2, 0), total: 10 })
        .mockResolvedValueOnce({ rows: [], total: 10 })
        // The retry: everything is there this time.
        .mockResolvedValueOnce({ rows: filler(2, 0), total: 2 });
      await renderEditor();
      typeDates("2026-07-10", "2026-07-14");
      await userEvent.click(screen.getByTestId("stay-editor-save"));
      await screen.findByTestId("stay-conflict-notice");

      await userEvent.click(screen.getByTestId("stay-conflict-retry"));
      await waitFor(() => expect(createStay).toHaveBeenCalledTimes(1));
      expect(listStayPage).toHaveBeenCalledTimes(3);
    });

    it("a notice that lists collisions AND is incomplete keeps both the retry and 'Termine ändern'", async () => {
      vi.mocked(listStayPage)
        .mockResolvedValueOnce({
          rows: [
            storedStay({
              id: "hit",
              checkIn: "2026-07-12T00:00:00.000Z",
              checkOut: "2026-07-16T00:00:00.000Z",
            }),
          ],
          total: 10,
        })
        .mockResolvedValueOnce({ rows: [], total: 10 });
      await renderEditor();
      typeDates("2026-07-10", "2026-07-14");
      await userEvent.click(screen.getByTestId("stay-editor-save"));

      await screen.findByTestId("stay-conflict-hit");
      expect(screen.getByTestId("stay-conflict-retry")).toBeInTheDocument();
      expect(getNamed("button", "lodging:conflict.changeDates")).toBeInTheDocument();
    });
  });
});
