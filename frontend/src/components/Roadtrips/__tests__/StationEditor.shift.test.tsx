import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import StationEditor from "../StationEditor";
import { roadtripsApi } from "../../../lib/api/roadtrips";
import { createStay } from "../../../lib/api/lodging";
import type { RoadtripStation, StationInput } from "../../../types/roadtrip";

/**
 * forgejo#241: "Ab hier verschieben" moves this and every following station
 * by N calendar days — after a preview, never touching a linked stay, and one
 * undo step that says what it restores.
 */
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && "count" in o ? `${k}#${String(o.count)}` : o?.name ? `${k}:${String(o.name)}` : k,
    i18n: { language: "de" },
  }),
}));
vi.mock("../../location/LocationInput", () => ({ LocationInput: () => <div /> }));
vi.mock("../../../lib/api/lodging", () => ({
  listLodgings: vi.fn().mockResolvedValue([
    {
      id: "l-lom",
      name: "Camping Lom",
      lat: 61.8,
      lon: 8.5,
      stays: [
        {
          id: "s-lom",
          checkIn: "2026-07-12T00:00:00.000Z",
          checkOut: "2026-07-14T00:00:00.000Z",
          datePrecision: "DAY",
          status: "completed",
        },
      ],
    },
  ]),
  createLodging: vi.fn(),
  createStay: vi.fn(),
  deleteLodging: vi.fn(),
}));
vi.mock("../../../lib/api/trips", () => ({ tripsApi: { getAll: vi.fn(async () => []) } }));
vi.mock("../../../lib/api/roadtrips", () => ({
  roadtripsApi: { replaceStations: vi.fn(), get: vi.fn(), list: vi.fn(async () => []) },
}));

const id = (n: number): string => `0000000${n}-0000-4000-8000-000000000000`;
const base = {
  lat: 61,
  lon: 8,
  notes: null,
  order: 0,
  lodgingStayId: null,
  stay: null,
} as const;
const STATIONS: RoadtripStation[] = [
  {
    ...base,
    id: id(1),
    title: "Bergen",
    startDate: "2026-07-10T00:00:00.000Z",
    endDate: "2026-07-12T00:00:00.000Z",
    state: "free",
  },
  {
    ...base,
    id: id(2),
    title: "Lom",
    startDate: "2026-07-12T00:00:00.000Z",
    endDate: "2026-07-14T00:00:00.000Z",
    state: "stay",
    lodgingStayId: "s-lom",
    stay: { id: "s-lom", lodgingId: "l-lom", lodgingName: "Camping Lom" } as never,
  },
  {
    ...base,
    id: id(3),
    title: "Geiranger",
    startDate: "2026-07-14T00:00:00.000Z",
    endDate: "2026-07-15T00:00:00.000Z",
    state: "free",
  },
];

function renderEditor(): void {
  render(
    <MemoryRouter>
      <StationEditor
        routeId="rt"
        stations={STATIONS}
        legs={[]}
        tripId={null}
        start="plain"
        today="2026-07-01"
        onSaved={vi.fn()}
        onStatus={vi.fn()}
        onEditLeg={vi.fn()}
      />
    </MemoryRouter>
  );
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const lastSent = (): StationInput[] => {
  const calls = vi.mocked(roadtripsApi.replaceStations).mock.calls;
  return calls[calls.length - 1][1];
};
const days = (
  list: StationInput[]
): Array<[string | null | undefined, string | null | undefined]> =>
  list.map((s) => [s.startDate?.slice(0, 10), s.endDate?.slice(0, 10)]);

async function openShiftFrom(title: string): Promise<HTMLElement> {
  renderEditor();
  await wait(0);
  fireEvent.click(screen.getByText(title));
  fireEvent.click(screen.getByText("roadtrips:shift.open"));
  await wait(0);
  return screen.getByRole("dialog");
}

describe("StationEditor — shifting the following days (forgejo#241)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(roadtripsApi.replaceStations).mockImplementation(
      async (_r, list: StationInput[]) => ({
        roadtrip: {} as never,
        nights: {} as never,
        legs: [],
        stations: list.map((s) => ({ ...STATIONS[0], ...s, id: s.id ?? "x" }) as never),
      })
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("previews the new dates and lists the linked stay to check, with a way to it", async () => {
    const dialog = await openShiftFrom("Lom");
    fireEvent.change(within(dialog).getByLabelText("roadtrips:shift.days"), {
      target: { value: "2" },
    });
    const preview = within(dialog).getByTestId("shift-preview");
    expect(preview).toHaveTextContent("Lom12.07. – 14.07.14.07. – 16.07.");
    expect(preview).toHaveTextContent("Geiranger14.07. – 15.07.16.07. – 17.07.");
    expect(preview).not.toHaveTextContent("Bergen");

    const notices = within(dialog).getByTestId("shift-notices");
    expect(notices).toHaveTextContent("roadtrips:shift.notice.linkedStay:Camping Lom");
    expect(within(notices).getByText("roadtrips:shift.check").closest("a")).toHaveAttribute(
      "href",
      "/lodging/l-lom"
    );
  });

  it("changes nothing when cancelled", async () => {
    const dialog = await openShiftFrom("Lom");
    fireEvent.click(within(dialog).getByText("common:buttons.cancel"));
    await wait(1000);
    expect(roadtripsApi.replaceStations).not.toHaveBeenCalled();
  });

  it("moves this and the following stations, never the stay, and undoes exactly that", async () => {
    const dialog = await openShiftFrom("Lom");
    fireEvent.click(within(dialog).getByLabelText("roadtrips:shift.later"));
    fireEvent.click(within(dialog).getByText("roadtrips:shift.apply"));
    await wait(800);
    // One day by default, one more from the stepper.
    expect(days(lastSent())).toEqual([
      ["2026-07-10", "2026-07-12"],
      ["2026-07-14", "2026-07-16"],
      ["2026-07-16", "2026-07-17"],
    ]);
    expect(lastSent()[1].night).toEqual({ kind: "stay", lodgingStayId: "s-lom" });
    expect(createStay).not.toHaveBeenCalled();

    expect(screen.getByText("roadtrips:shift.done#2")).toBeInTheDocument();
    expect(screen.getByText("roadtrips:shift.undoRestores#2")).toBeInTheDocument();
    fireEvent.click(screen.getByText("roadtrips:editor.undo"));
    await wait(800);
    expect(days(lastSent())).toEqual([
      ["2026-07-10", "2026-07-12"],
      ["2026-07-12", "2026-07-14"],
      ["2026-07-14", "2026-07-15"],
    ]);
  });

  it("explains a disabled shift by zero days, and names a start before the station in front", async () => {
    const dialog = await openShiftFrom("Lom");
    fireEvent.change(within(dialog).getByLabelText("roadtrips:shift.days"), {
      target: { value: "0" },
    });
    expect(within(dialog).getByText("roadtrips:shift.apply").closest("button")).toBeDisabled();
    expect(within(dialog).getByTestId("save-blocked-hint")).toHaveTextContent(
      "roadtrips:shift.missingDays"
    );
    fireEvent.change(within(dialog).getByLabelText("roadtrips:shift.days"), {
      target: { value: "-1" },
    });
    expect(within(dialog).getByTestId("shift-notices")).toHaveTextContent(
      "roadtrips:shift.notice.beforePrevious:Lom"
    );
  });
});
