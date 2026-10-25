import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const caps = vi.hoisted(() => ({
  current: { version: 1, offered: true, enabled: true, active: true, hasData: true } as {
    version: 1;
    offered: boolean;
    enabled: boolean;
    active: boolean;
    hasData: boolean;
  } | null,
}));
vi.mock("../../../hooks/useTravTrackVisible", () => ({
  useTravTrackCapabilities: () => caps.current,
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({ isFeatureVisible: () => true }),
}));
// The trip note reads the home periods on its own; covered by TravTrackTripNote.test.tsx.
vi.mock("../TravTrackTripNote", () => ({ default: () => null }));
vi.mock("../../../hooks/useTodayZone", () => ({
  useTodayZone: () => "UTC",
  todayZoneNow: () => "UTC",
}));

import TravTrackSection from "../TravTrackSection";
import { dawarichCopyApi } from "../../../lib/api/travtrackDawarichCopy";
import { travTrackApi } from "../../../lib/api/travtrack";
import { travTrackImportsApi } from "../../../lib/api/travtrackImports";
import { travTrackMonthsApi } from "../../../lib/api/travtrackMonths";

/**
 * TravTrack in Settings (TravTrack plan T6, ported from the archived
 * `LocationHistorySection` minus the source and transfer cases): the summary,
 * privacy zones that ask before they delete stored positions, delete by days
 * — and with TravTrack switched off, everything but adding a zone.
 */

const ZONE = { id: "z1", name: "Zuhause", lat: 52.52, lon: 13.405, radiusM: 250 };
const EMPTY = {
  pointCount: 0,
  firstAt: null,
  lastAt: null,
  lastReceivedAt: null,
  devices: [],
  deletedRanges: 0,
  zones: 0,
};
const HELD = {
  ...EMPTY,
  pointCount: 12,
  firstAt: "2026-10-01T08:00:00.000Z",
  lastAt: "2026-10-03T18:00:00.000Z",
  devices: [{ deviceId: "phone-1", pointCount: 12 }],
};

function conflict(pointsInside: number) {
  return Object.assign(new Error("409"), {
    response: { status: 409, data: { code: "LOCATION_ZONE_HOLDS_POINTS", pointsInside } },
  });
}

async function confirmInDialog() {
  const dialog = await screen.findByRole("dialog");
  const buttons = within(dialog).getAllByRole("button");
  await userEvent.click(buttons[buttons.length - 1]);
}

const show = () =>
  render(
    <MemoryRouter>
      <TravTrackSection />
    </MemoryRouter>
  );

describe("TravTrackSection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // The Dawarich copy block (plan L6) reads its state on mount.
    vi.spyOn(dawarichCopyApi, "get").mockResolvedValue({ connection: "none", copy: null });
    caps.current = { version: 1, offered: true, enabled: true, active: true, hasData: true };
    vi.spyOn(travTrackApi, "summary").mockResolvedValue(EMPTY);
    vi.spyOn(travTrackApi, "zones").mockResolvedValue([]);
    vi.spyOn(travTrackImportsApi, "list").mockResolvedValue([]);
    vi.spyOn(travTrackMonthsApi, "cityLookup").mockResolvedValue(false);
  });

  it("says what is stored, and that nothing is", async () => {
    show();
    expect(await screen.findByText("track:settings.empty")).toBeInTheDocument();
    expect(screen.getByText("track:settings.zones.none")).toBeInTheDocument();
  });

  it("asks before a new zone deletes stored positions, then adds it", async () => {
    const create = vi
      .spyOn(travTrackApi, "createZone")
      .mockRejectedValueOnce(conflict(7))
      .mockResolvedValueOnce({ zone: ZONE, deleted: 7 });
    show();
    const add = await screen.findByRole("button", { name: "track:settings.zones.add" });
    expect(add).toBeDisabled();

    await userEvent.type(screen.getByLabelText("track:settings.zones.name"), "Zuhause");
    await userEvent.type(screen.getByLabelText("track:settings.zones.centre"), "52.52, 13.405");
    await userEvent.click(add);
    await confirmInDialog();

    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create).toHaveBeenNthCalledWith(1, {
      name: "Zuhause",
      lat: 52.52,
      lon: 13.405,
      radiusM: 250,
    });
    expect(create).toHaveBeenNthCalledWith(2, {
      name: "Zuhause",
      lat: 52.52,
      lon: 13.405,
      radiusM: 250,
      deleteStoredPoints: true,
    });
    expect(await screen.findByText("track:settings.zones.addedDeleted")).toBeInTheDocument();
  });

  it("names coordinates it cannot read and adds nothing", async () => {
    show();
    await userEvent.type(await screen.findByLabelText("track:settings.zones.name"), "x");
    await userEvent.type(screen.getByLabelText("track:settings.zones.centre"), "somewhere");
    expect(screen.getByText("track:settings.zones.centreInvalid")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "track:settings.zones.add" })).toBeDisabled();
  });

  it("removes a zone after confirmation", async () => {
    vi.spyOn(travTrackApi, "zones").mockResolvedValue([ZONE]);
    const remove = vi.spyOn(travTrackApi, "deleteZone").mockResolvedValue();
    show();
    await userEvent.click(
      await screen.findByRole("button", { name: "track:settings.zones.remove" })
    );
    await confirmInDialog();
    await waitFor(() => expect(remove).toHaveBeenCalledWith("z1"));
  });

  it("deletes the chosen days after confirmation and says how many", async () => {
    vi.spyOn(travTrackApi, "summary").mockResolvedValue({ ...HELD, pointCount: 42 });
    const del = vi.spyOn(travTrackApi, "deleteDays").mockResolvedValue(42);
    show();
    const button = await screen.findByRole("button", { name: "track:settings.delete.do" });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText("track:settings.delete.from"), "2026-10-01");
    await userEvent.type(screen.getByLabelText("track:settings.delete.to"), "2026-10-03");
    await userEvent.click(button);
    await confirmInDialog();
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith({ fromDay: "2026-10-01", toDay: "2026-10-03" })
    );
    expect(travTrackApi.summary).toHaveBeenCalledWith({
      fromDay: "2026-10-01",
      toDay: "2026-10-03",
    });
    expect(await screen.findByText("track:settings.delete.done")).toBeInTheDocument();
  });

  it("with TravTrack off and data held, offers summary, export and delete, and no zone add", async () => {
    caps.current = { version: 1, offered: true, enabled: false, active: false, hasData: true };
    vi.spyOn(travTrackApi, "summary").mockResolvedValue(HELD);
    vi.spyOn(travTrackApi, "zones").mockResolvedValue([ZONE]);
    show();
    expect(await screen.findByText("track:settings.summary")).toBeInTheDocument();
    expect(screen.getByTestId("travtrack-off")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "track:actions.export" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "track:settings.delete.do" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "track:settings.zones.remove" })).toBeInTheDocument();
    expect(screen.queryByLabelText("track:settings.zones.name")).not.toBeInTheDocument();
    // TravTrack off: no way to /track from here.
    expect(screen.queryByText("track:settings.open")).not.toBeInTheDocument();
  });

  it("shows nothing for an account without data while TravTrack is off", () => {
    caps.current = { version: 1, offered: true, enabled: false, active: false, hasData: false };
    const { container } = show();
    expect(container).toBeEmptyDOMElement();
  });
});
