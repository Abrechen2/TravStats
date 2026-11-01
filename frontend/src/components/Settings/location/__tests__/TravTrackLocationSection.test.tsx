import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}${JSON.stringify(o)}` : k),
  }),
}));
const caps = vi.hoisted(() => ({
  current: {
    version: 1,
    offered: true,
    enabled: true,
    active: true,
    hasData: true,
    sources: ["owntracks", "overland"],
  } as {
    version: 1;
    offered: boolean;
    enabled: boolean;
    active: boolean;
    hasData: boolean;
    sources?: string[];
  } | null,
}));
vi.mock("../../../../hooks/useTravTrackVisible", () => ({
  useTravTrackCapabilities: () => caps.current,
}));
const demo = vi.hoisted(() => ({ current: false }));
vi.mock("../../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => demo.current }));
vi.mock("../../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({ isFeatureVisible: () => true }),
}));
const expert = vi.hoisted(() => ({ current: false }));
vi.mock("../../frame/useExpertRows", () => ({ useExpertRows: () => expert.current }));
vi.mock("../../TravTrackTripNote", () => ({ default: () => null }));
vi.mock("../../TravTrackDiagnostics", () => ({
  default: () => <div data-testid="diagnostics" />,
}));
vi.mock("../../../../hooks/useTodayZone", () => ({
  useTodayZone: () => "UTC",
  todayZoneNow: () => "UTC",
}));
const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

import TravTrackLocationSection from "../TravTrackLocationSection";
import { dawarichCopyApi } from "../../../../lib/api/travtrackDawarichCopy";
import { travTrackApi } from "../../../../lib/api/travtrack";
import { travTrackImportsApi } from "../../../../lib/api/travtrackImports";
import { travTrackMonthsApi } from "../../../../lib/api/travtrackMonths";
import { travTrackSourcesApi } from "../../../../lib/api/travtrackSources";
import { resetWriteQueue } from "../../../ui/settings/writeQueue";

/**
 * Standort → TravTrack and Verlauf on the settings blocks: every refusal stays
 * under its row in the first person and retries there; every danger goes
 * through the confirmation block with the amount.
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
const conflict = (pointsInside: number) =>
  Object.assign(new Error("409"), {
    response: { status: 409, data: { code: "LOCATION_ZONE_HOLDS_POINTS", pointsInside } },
  });
const failure = (status = 500) => Object.assign(new Error("x"), { response: { status, data: {} } });
const settle = (): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 450));
  });

async function confirmInDialog(): Promise<HTMLElement> {
  const dialog = await screen.findByRole("dialog");
  const buttons = within(dialog).getAllByRole("button");
  await userEvent.click(buttons[buttons.length - 1]);
  return dialog;
}
const show = () =>
  render(
    <MemoryRouter>
      <TravTrackLocationSection />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.restoreAllMocks();
  demo.current = false;
  expert.current = false;
  caps.current = {
    version: 1,
    offered: true,
    enabled: true,
    active: true,
    hasData: true,
    sources: ["owntracks", "overland"],
  };
  navigate.mockReset();
  vi.spyOn(dawarichCopyApi, "get").mockResolvedValue({ connection: "none", copy: null });
  vi.spyOn(travTrackApi, "summary").mockResolvedValue(EMPTY);
  vi.spyOn(travTrackApi, "zones").mockResolvedValue([]);
  vi.spyOn(travTrackImportsApi, "list").mockResolvedValue([]);
  vi.spyOn(travTrackMonthsApi, "cityLookup").mockResolvedValue(false);
  vi.spyOn(travTrackSourcesApi, "list").mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  act(() => resetWriteQueue());
});

describe("TravTrack: what is stored and the privacy zones", () => {
  it("says what is stored, and that nothing is", async () => {
    show();
    expect(await screen.findByText("settings:location.tt.sum.empty")).toBeInTheDocument();
    expect(screen.getByText("settings:location.tt.zones.none")).toBeInTheDocument();
  });

  it("never draws 'nothing stored' for a load that failed; it retries", async () => {
    vi.spyOn(travTrackApi, "summary").mockRejectedValueOnce(failure());
    show();
    expect(await screen.findByText("settings:location.tt.sum.loadError")).toBeInTheDocument();
    expect(screen.queryByText("settings:location.tt.sum.empty")).toBeNull();
    expect(screen.getByText("settings:location.tt.zones.loadError")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "settings:blocks.save.retry" })[0]);
    expect(await screen.findByText("settings:location.tt.sum.empty")).toBeInTheDocument();
  });

  it("asks before a new zone deletes stored positions, naming the amount, then adds it", async () => {
    const create = vi
      .spyOn(travTrackApi, "createZone")
      .mockRejectedValueOnce(conflict(7))
      .mockResolvedValueOnce({ zone: ZONE, deleted: 7 });
    show();
    const add = await screen.findByRole("button", { name: "settings:location.tt.zones.add" });
    expect(add).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText("settings:location.tt.zones.fields.name"),
      "Zuhause"
    );
    await userEvent.type(
      screen.getByLabelText("settings:location.tt.zones.fields.centre"),
      "52.52, 13.405"
    );
    await userEvent.click(add);
    await confirmInDialogWith(/"count":7/);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create).toHaveBeenNthCalledWith(2, {
      name: "Zuhause",
      lat: 52.52,
      lon: 13.405,
      radiusM: 250,
      deleteStoredPoints: true,
    });
    expect(
      await screen.findByText(/settings:location\.tt\.zones\.addedDeleted/)
    ).toBeInTheDocument();
  });

  it("a declined confirmation deletes nothing and adds no zone", async () => {
    const create = vi.spyOn(travTrackApi, "createZone").mockRejectedValueOnce(conflict(7));
    show();
    await userEvent.type(
      await screen.findByLabelText("settings:location.tt.zones.fields.name"),
      "Zuhause"
    );
    await userEvent.type(
      screen.getByLabelText("settings:location.tt.zones.fields.centre"),
      "52.52, 13.405"
    );
    await userEvent.click(screen.getByRole("button", { name: "settings:location.tt.zones.add" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "settings:blocks.confirm.cancel" })
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("a zone that is not saved keeps the form and offers a retry", async () => {
    const create = vi
      .spyOn(travTrackApi, "createZone")
      .mockRejectedValueOnce(failure())
      .mockResolvedValueOnce({ zone: ZONE, deleted: 0 });
    show();
    await userEvent.type(
      await screen.findByLabelText("settings:location.tt.zones.fields.name"),
      "Zuhause"
    );
    await userEvent.type(
      screen.getByLabelText("settings:location.tt.zones.fields.centre"),
      "52.52, 13.405"
    );
    await userEvent.click(screen.getByRole("button", { name: "settings:location.tt.zones.add" }));
    expect(await screen.findByText(/settings:location\.tt\.zones\.notAdded/)).toBeInTheDocument();
    expect(screen.getByLabelText("settings:location.tt.zones.fields.name")).toHaveValue("Zuhause");
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.save.retry" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("settings:location.tt.zones.added")).toBeInTheDocument();
  });

  it("names coordinates it cannot read and adds nothing", async () => {
    show();
    await userEvent.type(
      await screen.findByLabelText("settings:location.tt.zones.fields.name"),
      "x"
    );
    await userEvent.type(
      screen.getByLabelText("settings:location.tt.zones.fields.centre"),
      "somewhere"
    );
    expect(screen.getByText("settings:location.tt.zones.centreInvalid")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "settings:location.tt.zones.add" })).toBeDisabled();
  });

  it("removes a zone only after the confirmation says nothing comes back", async () => {
    vi.spyOn(travTrackApi, "zones").mockResolvedValue([ZONE]);
    const remove = vi.spyOn(travTrackApi, "deleteZone").mockResolvedValue();
    show();
    await userEvent.click(await screen.findByRole("button", { name: /zones\.remove: Zuhause/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("settings:location.tt.zones.removeAfter")).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
    await confirmInDialog();
    await waitFor(() => expect(remove).toHaveBeenCalledWith("z1"));
  });

  it("a zone that is not removed stays in the list and offers a retry", async () => {
    vi.spyOn(travTrackApi, "zones").mockResolvedValue([ZONE]);
    const remove = vi
      .spyOn(travTrackApi, "deleteZone")
      .mockRejectedValueOnce(failure())
      .mockResolvedValueOnce();
    show();
    await userEvent.click(await screen.findByRole("button", { name: /zones\.remove: Zuhause/ }));
    await confirmInDialog();
    expect(await screen.findByText(/settings:location\.tt\.zones\.notRemoved/)).toBeInTheDocument();
    expect(screen.getByText(/Zuhause/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.save.retry" }));
    await confirmInDialog();
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(2));
  });
});

async function confirmInDialogWith(amount: RegExp): Promise<HTMLElement> {
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getAllByText(amount).length).toBeGreaterThan(0);
  const buttons = within(dialog).getAllByRole("button");
  await userEvent.click(buttons[buttons.length - 1]);
  return dialog;
}

describe("TravTrack: city lookup", () => {
  it("writes the consent on its row and keeps the choice when the server refuses", async () => {
    const put = vi
      .spyOn(travTrackMonthsApi, "setCityLookup")
      .mockRejectedValueOnce(failure())
      .mockResolvedValueOnce(true);
    show();
    const toggle = await screen.findByRole("switch", { name: "settings:location.tt.cities.name" });
    fireEvent.click(toggle);
    await settle();
    expect(await screen.findByRole("button", { name: "settings:blocks.save.retry" })).toBeVisible();
    expect(
      screen.getByRole("switch", { name: "settings:location.tt.cities.name" })
    ).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "settings:blocks.save.retry" }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
  });

  it("draws no switch for a setting it could not read, and says so", async () => {
    vi.spyOn(travTrackMonthsApi, "cityLookup").mockRejectedValueOnce(failure());
    show();
    expect(await screen.findByText("settings:location.tt.cities.loadError")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "settings:location.tt.cities.name" })).toBeNull();
  });

  it("only takes effect with TravTrack as the source, and says so", async () => {
    caps.current = { ...caps.current!, active: false };
    show();
    expect(await screen.findByText("settings:location.tt.cities.notSource")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "settings:location.tt.cities.name" })).toBeDisabled();
  });
});

describe("TravTrack: other apps (expert)", () => {
  it("is not drawn at the standard level", async () => {
    show();
    await screen.findByText("settings:location.tt.sum.empty");
    expect(screen.queryByText("settings:location.tt.apps.name")).toBeNull();
  });

  it("shows a new key once, and revoking asks first", async () => {
    expert.current = true;
    vi.spyOn(travTrackSourcesApi, "list").mockResolvedValue([
      { id: "k1", kind: "owntracks", label: "Phone", createdAt: "", lastUsedAt: null },
    ]);
    vi.spyOn(travTrackSourcesApi, "create").mockResolvedValue({
      id: "k2",
      kind: "overland",
      label: "Tablet",
      createdAt: "",
      lastUsedAt: null,
      token: "tt_ingest_secret",
      url: "https://x/ingest",
    });
    const revoke = vi.spyOn(travTrackSourcesApi, "revoke").mockResolvedValue();
    show();
    await userEvent.type(await screen.findByLabelText("settings:location.tt.apps.label"), "Tablet");
    await userEvent.click(screen.getByRole("button", { name: "settings:location.tt.apps.create" }));
    expect(await screen.findByDisplayValue("tt_ingest_secret")).toBeInTheDocument();
    expect(screen.getByText("settings:location.tt.apps.shownOnce")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "settings:location.tt.apps.done" }));
    expect(screen.queryByDisplayValue("tt_ingest_secret")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /apps\.revoke: Phone/ }));
    expect(revoke).not.toHaveBeenCalled();
    await confirmInDialog();
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("k1"));
  });

  it("a key that is not created says so and retries", async () => {
    expert.current = true;
    const create = vi
      .spyOn(travTrackSourcesApi, "create")
      .mockRejectedValueOnce(failure(429))
      .mockRejectedValueOnce(failure());
    show();
    await userEvent.type(await screen.findByLabelText("settings:location.tt.apps.label"), "T");
    await userEvent.click(screen.getByRole("button", { name: "settings:location.tt.apps.create" }));
    expect(await screen.findByText("track:sources.errors.rateLimited")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.save.retry" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/settings:location\.tt\.apps\.notCreated/)).toBeInTheDocument();
  });

  it("a key list that does not load is not 'no app connected'", async () => {
    expert.current = true;
    vi.spyOn(travTrackSourcesApi, "list").mockRejectedValue(failure());
    show();
    expect(await screen.findByText(/settings:location\.tt\.apps\.loadError/)).toBeInTheDocument();
    expect(screen.queryByText("settings:location.tt.apps.none")).toBeNull();
  });
});

describe("Verlauf: delete days and the rest", () => {
  const fillSpan = async () => {
    await userEvent.type(
      screen.getByLabelText("settings:location.history.delete.from"),
      "2026-10-01"
    );
    await userEvent.type(
      screen.getByLabelText("settings:location.history.delete.to"),
      "2026-10-03"
    );
  };

  it("counts exactly the chosen span, names that amount in the confirmation, then deletes", async () => {
    const summary = vi
      .spyOn(travTrackApi, "summary")
      .mockResolvedValueOnce(HELD)
      .mockResolvedValue({ ...HELD, pointCount: 42 });
    const del = vi.spyOn(travTrackApi, "deleteDays").mockResolvedValue(42);
    show();
    const button = await screen.findByRole("button", {
      name: "settings:location.history.delete.do",
    });
    expect(button).toBeDisabled();
    await fillSpan();
    await userEvent.click(button);
    await confirmInDialogWith(/"count":42/);
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith({ fromDay: "2026-10-01", toDay: "2026-10-03" })
    );
    expect(summary).toHaveBeenCalledWith({ fromDay: "2026-10-01", toDay: "2026-10-03" });
    expect(await screen.findByText(/settings:location\.history\.delete\.done/)).toBeInTheDocument();
  });

  it("when the amount cannot be counted nothing is deleted and the row retries", async () => {
    vi.spyOn(travTrackApi, "summary")
      .mockResolvedValueOnce(HELD)
      .mockRejectedValueOnce(failure())
      .mockResolvedValue({ ...HELD, pointCount: 5 });
    const del = vi.spyOn(travTrackApi, "deleteDays").mockResolvedValue(5);
    show();
    const button = await screen.findByRole("button", {
      name: "settings:location.history.delete.do",
    });
    await fillSpan();
    await userEvent.click(button);
    expect(
      await screen.findByText(/settings:location\.history\.delete\.notCounted/)
    ).toBeInTheDocument();
    expect(del).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.save.retry" }));
    await confirmInDialog();
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
  });

  it("a delete the server refuses says nothing was deleted and offers a retry", async () => {
    vi.spyOn(travTrackApi, "summary").mockResolvedValue({ ...HELD, pointCount: 5 });
    const del = vi.spyOn(travTrackApi, "deleteDays").mockRejectedValueOnce(failure());
    show();
    const button = await screen.findByRole("button", {
      name: "settings:location.history.delete.do",
    });
    await fillSpan();
    await userEvent.click(button);
    await confirmInDialog();
    expect(
      await screen.findByText(/settings:location\.history\.delete\.notDone/)
    ).toBeInTheDocument();
    expect(del).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "settings:blocks.save.retry" })).toBeVisible();
  });

  it("refuses a span that ends before it starts", async () => {
    show();
    await screen.findByRole("button", { name: "settings:location.history.delete.do" });
    await userEvent.type(
      screen.getByLabelText("settings:location.history.delete.from"),
      "2026-10-05"
    );
    await userEvent.type(
      screen.getByLabelText("settings:location.history.delete.to"),
      "2026-10-01"
    );
    expect(screen.getByText("settings:location.history.delete.invalidRange")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "settings:location.history.delete.do" })
    ).toBeDisabled();
  });

  it("offers the diagnostics only at the expert level", async () => {
    show();
    await screen.findByText("settings:location.tt.sum.empty");
    expect(screen.queryByText("settings:location.history.diag.name")).toBeNull();
    cleanup();
    expert.current = true;
    show();
    await userEvent.click(
      await screen.findByRole("button", { name: "settings:location.history.diag.open" })
    );
    expect(screen.getByTestId("diagnostics")).toBeInTheDocument();
  });

  it("with TravTrack off and data held, keeps summary, export, delete and zone removal, but no adds", async () => {
    caps.current = { version: 1, offered: true, enabled: false, active: false, hasData: true };
    vi.spyOn(travTrackApi, "summary").mockResolvedValue(HELD);
    vi.spyOn(travTrackApi, "zones").mockResolvedValue([ZONE]);
    show();
    expect(await screen.findByText(/settings:location\.tt\.sum\.value/)).toBeInTheDocument();
    expect(screen.getByTestId("travtrack-off")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "settings:location.history.export.label" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "settings:location.history.delete.do" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /zones\.remove: Zuhause/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("settings:location.tt.zones.fields.name")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText("settings:location.tt.sum.open")).toBeNull();
  });

  it("jumps to the imports while the Track area is open, instead of a second import list", async () => {
    show();
    await userEvent.click(
      await screen.findByRole("button", { name: /settings:location\.history\.gpx\.jump/ })
    );
    expect(navigate.mock.calls[0][0]).toBe("/track/imports");
    expect(travTrackImportsApi.list).not.toHaveBeenCalled();
  });

  it("keeps the imports here while the Track area is closed, so held data stays deletable", async () => {
    caps.current = { version: 1, offered: true, enabled: false, active: false, hasData: true };
    vi.spyOn(travTrackApi, "summary").mockResolvedValue(HELD);
    show();
    await screen.findByText(/settings:location\.tt\.sum\.value/);
    await waitFor(() => expect(travTrackImportsApi.list).toHaveBeenCalled());
  });

  it("is locked for the demo account: no delete, no add, no removal", async () => {
    demo.current = true;
    vi.spyOn(travTrackApi, "zones").mockResolvedValue([ZONE]);
    show();
    await screen.findByText(/Zuhause/);
    expect(
      screen.queryByRole("button", { name: "settings:location.history.delete.do" })
    ).toBeNull();
    expect(screen.queryByLabelText("settings:location.tt.zones.fields.name")).toBeNull();
    expect(screen.queryByRole("button", { name: /zones\.remove/ })).toBeNull();
  });

  it("shows nothing for an account without data while TravTrack is off", () => {
    caps.current = { version: 1, offered: true, enabled: false, active: false, hasData: false };
    const { container } = show();
    expect(container).toBeEmptyDOMElement();
  });
});
