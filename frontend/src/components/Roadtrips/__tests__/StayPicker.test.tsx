import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import StayPicker from "../StayPicker";
import { createLodging, createStay, deleteLodging } from "../../../lib/api/lodging";
import type { Lodging } from "../../../types/lodging";

vi.mock("../../../lib/api/lodging", () => ({
  createLodging: vi.fn(),
  createStay: vi.fn(),
  deleteLodging: vi.fn(),
  listLodgings: vi.fn(),
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../../lib/displayFormat", () => ({
  useDisplayFormat: () => ({ date: (v: string) => v.slice(0, 10) }),
}));

function renderPicker(onPick = vi.fn()): ReturnType<typeof vi.fn> {
  render(
    <StayPicker
      selectedStayId={null}
      near={{ startDate: "2026-07-14", endDate: "2026-07-16" }}
      place={{ name: "Mosvangen", lat: 58.95, lon: 5.72 }}
      tripId={null}
      onPick={onPick}
      lodgings={[]}
    />
  );
  fireEvent.click(screen.getByText("roadtrips:stay.createNew"));
  fireEvent.click(screen.getByText("roadtrips:stay.createAndLink"));
  return onPick;
}

describe("StayPicker — a new stay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createLodging).mockResolvedValue({ id: "l1", name: "Mosvangen" } as never);
  });

  it("links the stay it made", async () => {
    vi.mocked(createStay).mockResolvedValue({
      id: "s1",
      checkIn: "2026-07-14",
      checkOut: "2026-07-16",
    } as never);
    const onPick = renderPicker();
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" })));
    expect(deleteLodging).not.toHaveBeenCalled();
  });

  it("takes the lodging back when its stay could not be made, so no empty one is left", async () => {
    vi.mocked(createStay).mockRejectedValue(new Error("500"));
    vi.mocked(deleteLodging).mockResolvedValue();
    const onPick = renderPicker();
    expect(await screen.findByText("roadtrips:stay.createFailed")).toBeInTheDocument();
    expect(deleteLodging).toHaveBeenCalledWith("l1");
    expect(onPick).not.toHaveBeenCalled();
  });
});

function lodging(over: Partial<Lodging>): Lodging {
  return {
    id: "l",
    name: "",
    city: null,
    country: null,
    lat: null,
    lon: null,
    stays: [],
    ...over,
  } as Lodging;
}

const PREIKESTOLEN = lodging({
  id: "l-pre",
  name: "Preikestolen Camping",
  city: "Jørpeland",
  lat: 58.99,
  lon: 6.1,
});

function renderWith(lodgings: Lodging[], onPick = vi.fn()): ReturnType<typeof vi.fn> {
  render(
    <StayPicker
      selectedStayId={null}
      near={{ startDate: "2026-07-14", endDate: "2026-07-16" }}
      place={{ name: "Preikestolen", lat: null, lon: null }}
      tripId="trip-1"
      onPick={onPick}
      lodgings={lodgings}
    />
  );
  return onPick;
}

describe("StayPicker — every lodging, not only those with a stay", () => {
  beforeEach(() => vi.clearAllMocks());

  it("finds a lodging that has no stay yet, and creates its stay only when asked", async () => {
    vi.mocked(createStay).mockResolvedValue({
      id: "s-new",
      checkIn: "2026-07-14",
      checkOut: "2026-07-16",
      status: "planned",
    } as never);
    const onPick = renderWith([PREIKESTOLEN]);

    fireEvent.change(screen.getByPlaceholderText("roadtrips:stay.search"), {
      target: { value: "jørpe" },
    });
    fireEvent.click(screen.getByText("Preikestolen Camping"));
    expect(screen.getByText("roadtrips:stay.noStays")).toBeInTheDocument();
    expect(createStay).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("roadtrips:stay.createStay"));
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(createStay).toHaveBeenCalledWith("l-pre", {
      checkIn: "2026-07-14",
      checkOut: "2026-07-16",
      datePrecision: "DAY",
      tripId: "trip-1",
    });
    expect(createLodging).not.toHaveBeenCalled();
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s-new", lodgingId: "l-pre", lat: 58.99, lon: 6.1 })
    );
  });

  it("lists a chosen lodging's stays with the one covering the station first, and offers no new stay then", () => {
    const onPick = renderWith([
      {
        ...PREIKESTOLEN,
        stays: [
          { id: "s-2025", checkIn: "2025-07-01", checkOut: "2025-07-03", status: "completed" },
          { id: "s-2026", checkIn: "2026-07-13", checkOut: "2026-07-15", status: "completed" },
        ] as never,
      },
    ]);
    fireEvent.change(screen.getByPlaceholderText("roadtrips:stay.search"), {
      target: { value: "preike" },
    });
    // The lodging row, not the nearby-stay row above it.
    fireEvent.click(screen.getByText("Preikestolen Camping"));

    const rows = screen.getAllByRole("button", { pressed: false });
    expect(rows[0]).toHaveTextContent("2026-07-13");
    expect(rows[0]).toHaveTextContent("roadtrips:stay.fitsDate");
    expect(screen.queryByText("roadtrips:stay.createStay")).not.toBeInTheDocument();
    fireEvent.click(rows[0]);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "s-2026" }));
  });

  it("says so when the chosen lodging has no location", () => {
    renderWith([lodging({ id: "l-x", name: "Hütte ohne Pin" })]);
    fireEvent.click(screen.getByText("Hütte ohne Pin"));
    expect(screen.getByText("roadtrips:stay.noCoords")).toBeInTheDocument();
  });
});

/** forgejo#249: the search keeps a visible label, and rows reach touch size. */
describe("StayPicker — labels and touch", () => {
  it("labels the search visibly and sizes rows for a finger", () => {
    renderWith([lodging({ id: "l-y", name: "Camping Lom" })]);
    const search = screen.getByLabelText("roadtrips:stay.search");
    expect(search.closest("label")).toHaveTextContent("roadtrips:stay.search");
    expect(search.className).toContain("pointer-coarse:min-h-(--ts-size-touch-min)");
    expect(screen.getByText("Camping Lom").closest("button")?.className).toContain(
      "pointer-coarse:min-h-(--ts-size-touch-min)"
    );
  });
});
