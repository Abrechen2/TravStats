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
  current: null as {
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
const expert = vi.hoisted(() => ({ current: false }));
vi.mock("../../frame/useExpertRows", () => ({ useExpertRows: () => expert.current }));
vi.mock("../../TravTrackTripNote", () => ({ default: () => null }));
vi.mock("../../location/StayScanSection", () => ({ default: () => null }));
vi.mock("../../location/LocationSourceSection", () => ({
  default: () => null,
  DAWARICH_CONNECTION_PATH: "/settings/services?service=dawarich",
}));
vi.mock("../../TripRecordingSection", () => ({ default: () => null }));
vi.mock("../../TravTrackDiagnostics", () => ({ default: () => <div data-testid="diagnostics" /> }));
vi.mock("../../../../hooks/useTodayZone", () => ({
  useTodayZone: () => "UTC",
  todayZoneNow: () => "UTC",
}));
const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));
const exportDialog = vi.hoisted(() => vi.fn());
vi.mock("../../../../pages/Track/TrackExportDialog", () => ({
  default: (props: { open: boolean; fromDay: string; toDay: string }) => {
    exportDialog(props);
    return props.open ? (
      <div data-testid="export-dialog">{`${props.fromDay}..${props.toDay}`}</div>
    ) : null;
  },
}));

import TravTrackZonesSection from "../TravTrackZonesSection";
import TravTrackDetectSection from "../TravTrackDetectSection";
import TravTrackSourcesSection from "../TravTrackSourcesSection";
import TravTrackDeleteSection from "../TravTrackDeleteSection";
import TravTrackExportSection from "../TravTrackExportSection";
import TravTrackRecordingSection from "../TravTrackRecordingSection";
import { dawarichCopyApi } from "../../../../lib/api/travtrackDawarichCopy";
import { travTrackApi } from "../../../../lib/api/travtrack";
import { travTrackImportsApi } from "../../../../lib/api/travtrackImports";
import { travTrackMonthsApi } from "../../../../lib/api/travtrackMonths";
import { travTrackSourcesApi } from "../../../../lib/api/travtrackSources";
import { resetWriteQueue } from "../../../ui/settings/writeQueue";

/**
 * The TravTrack settings page's sections (web redesign, 2026-11-05): every
 * refusal stays under its row and retries there; every danger goes through the
 * confirmation block with the amount; export, delete and key revocation stay
 * reachable while TravTrack is off on the server and the account holds data.
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
async function confirmInDialogWith(amount: RegExp): Promise<HTMLElement> {
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getAllByText(amount).length).toBeGreaterThan(0);
  const buttons = within(dialog).getAllByRole("button");
  await userEvent.click(buttons[buttons.length - 1]);
  return dialog;
}
const show = (ui: JSX.Element, url = "/") =>
  render(<MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>);

const ON = {
  version: 1 as const,
  offered: true,
  enabled: true,
  active: true,
  hasData: true,
  sources: ["owntracks", "overland"],
};

beforeEach(() => {
  vi.restoreAllMocks();
  demo.current = false;
  expert.current = false;
  caps.current = { ...ON };
  navigate.mockReset();
  exportDialog.mockReset();
  vi.spyOn(dawarichCopyApi, "get").mockResolvedValue({ connection: "none", copy: null });
  vi.spyOn(travTrackApi, "summary").mockResolvedValue(EMPTY);
  vi.spyOn(travTrackApi, "lastSeen").mockResolvedValue(null);
  vi.spyOn(travTrackApi, "zones").mockResolvedValue([]);
  vi.spyOn(travTrackImportsApi, "list").mockResolvedValue([]);
  vi.spyOn(travTrackMonthsApi, "cityLookup").mockResolvedValue(false);
  vi.spyOn(travTrackSourcesApi, "list").mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  act(() => resetWriteQueue());
});

describe("Aufzeichnung: what is stored", () => {
  it("says what is stored, with the phones that send, and links to pairing", async () => {
    vi.spyOn(travTrackApi, "summary").mockResolvedValue(HELD);
    show(<TravTrackRecordingSection />);
    expect(await screen.findByText(/settings:tt\.recording\.stored\.value/)).toBeInTheDocument();
    expect(screen.getByText(/phone-1/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /settings:tt\.recording\.devices\.jump/ })
    );
    expect(navigate).toHaveBeenCalledWith("/settings/account#devices", undefined);
  });

  it("never draws 'nothing stored' for a load that failed; it retries", async () => {
    vi.spyOn(travTrackApi, "summary").mockRejectedValueOnce(failure());
    show(<TravTrackRecordingSection />);
    expect(await screen.findByText("settings:tt.recording.loadError")).toBeInTheDocument();
    expect(screen.queryByText("settings:tt.recording.stored.empty")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "settings:blocks.save.retry" }));
    expect(await screen.findByText("settings:tt.recording.stored.empty")).toBeInTheDocument();
  });
});

describe("Schutzzonen: list, add, edit, remove", () => {
  it("asks before a new zone deletes stored positions, naming the amount, then adds it", async () => {
    const create = vi
      .spyOn(travTrackApi, "createZone")
      .mockRejectedValueOnce(conflict(7))
      .mockResolvedValueOnce({ zone: ZONE, deleted: 7 });
    show(<TravTrackZonesSection />);
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
  });

  it("a zone that is not saved keeps the form and offers a retry", async () => {
    const create = vi
      .spyOn(travTrackApi, "createZone")
      .mockRejectedValueOnce(failure())
      .mockResolvedValueOnce({ zone: ZONE, deleted: 0 });
    show(<TravTrackZonesSection />);
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
  });

  it("explains how a zone differs from a fixed place", async () => {
    show(<TravTrackZonesSection />);
    expect(await screen.findByText("settings:tt.zones.difference")).toBeInTheDocument();
  });

  it("edits a zone through PATCH, keeping the form when the server refuses", async () => {
    vi.spyOn(travTrackApi, "zones").mockResolvedValue([ZONE]);
    const patch = vi
      .spyOn(travTrackApi, "updateZone")
      .mockRejectedValueOnce(failure())
      .mockResolvedValueOnce({ zone: { ...ZONE, radiusM: 500 }, deleted: 0 });
    show(<TravTrackZonesSection />);
    await userEvent.click(await screen.findByRole("button", { name: /zones\.edit: Zuhause/ }));
    await userEvent.selectOptions(
      screen.getByLabelText("settings:location.tt.zones.fields.radius", {
        selector: "#travtrack-zone-edit-radius",
      }),
      "500"
    );
    await userEvent.click(screen.getByRole("button", { name: "settings:location.tt.zones.save" }));
    expect(await screen.findByText(/settings:location\.tt\.zones\.notSaved/)).toBeInTheDocument();
    expect(
      screen.getByLabelText("settings:location.tt.zones.fields.name", {
        selector: "#travtrack-zone-edit-name",
      })
    ).toHaveValue("Zuhause");
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.save.retry" }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
    expect(patch).toHaveBeenLastCalledWith("z1", {
      name: "Zuhause",
      lat: 52.52,
      lon: 13.405,
      radiusM: 500,
    });
  });

  it("removes a zone only after the confirmation says nothing comes back", async () => {
    vi.spyOn(travTrackApi, "zones").mockResolvedValue([ZONE]);
    const remove = vi.spyOn(travTrackApi, "deleteZone").mockResolvedValue();
    show(<TravTrackZonesSection />);
    await userEvent.click(await screen.findByRole("button", { name: /zones\.remove: Zuhause/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("settings:location.tt.zones.removeAfter")).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
    await confirmInDialog();
    await waitFor(() => expect(remove).toHaveBeenCalledWith("z1"));
  });
});

describe("Erkennung: city lookup", () => {
  it("writes the consent on its row and keeps the choice when the server refuses", async () => {
    const put = vi
      .spyOn(travTrackMonthsApi, "setCityLookup")
      .mockRejectedValueOnce(failure())
      .mockResolvedValueOnce(true);
    show(<TravTrackDetectSection />);
    fireEvent.click(
      await screen.findByRole("switch", { name: "settings:location.tt.cities.name" })
    );
    await settle();
    expect(await screen.findByRole("button", { name: "settings:blocks.save.retry" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "settings:blocks.save.retry" }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
  });
});

describe("Quellen: other apps (expert) and token revocation", () => {
  it("is not drawn at the standard level", async () => {
    show(<TravTrackSourcesSection />);
    await screen.findByText("settings:tt.sources.files.name");
    expect(screen.queryByText("settings:location.tt.apps.name")).toBeNull();
  });

  it("revokes a key after asking, also while TravTrack is off on the server", async () => {
    expert.current = true;
    caps.current = { ...ON, enabled: false, active: false };
    vi.spyOn(travTrackSourcesApi, "list").mockResolvedValue([
      { id: "k1", kind: "owntracks", label: "Phone", createdAt: "", lastUsedAt: null },
    ]);
    const revoke = vi.spyOn(travTrackSourcesApi, "revoke").mockResolvedValue();
    show(<TravTrackSourcesSection />);
    await userEvent.click(await screen.findByRole("button", { name: /apps\.revoke: Phone/ }));
    expect(revoke).not.toHaveBeenCalled();
    await confirmInDialog();
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("k1"));
  });

  it("keeps the import list on the page and its jump to the Dawarich connection", async () => {
    show(<TravTrackSourcesSection />);
    await userEvent.click(
      await screen.findByRole("button", { name: /settings:tt\.sources\.dawarich\.jump/ })
    );
    expect(navigate).toHaveBeenCalledWith("/settings/services?service=dawarich", undefined);
  });
});

describe("Zeitraum löschen", () => {
  const fillSpan = async () => {
    await userEvent.type(screen.getByLabelText("settings:tt.delete.from"), "2026-10-01");
    await userEvent.type(screen.getByLabelText("settings:tt.delete.until"), "2026-10-03");
  };

  it("counts exactly the chosen span, asks for the typed word, then deletes", async () => {
    const summary = vi
      .spyOn(travTrackApi, "summary")
      .mockResolvedValue({ ...HELD, pointCount: 42 });
    const del = vi.spyOn(travTrackApi, "deleteDays").mockResolvedValue(42);
    show(<TravTrackDeleteSection />);
    const button = await screen.findByRole("button", { name: "settings:tt.delete.do" });
    expect(button).toBeDisabled();
    await fillSpan();
    await waitFor(() => expect(button).toBeEnabled());
    expect(summary).toHaveBeenLastCalledWith({ fromDay: "2026-10-01", toDay: "2026-10-03" });
    await userEvent.click(button);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText(/"count":42/).length).toBeGreaterThan(0);
    const confirm = within(dialog).getAllByRole("button").pop()!;
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox"), "settings:tt.delete.confirm.word");
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith({ fromDay: "2026-10-01", toDay: "2026-10-03" })
    );
    expect(await screen.findByText(/settings:tt\.delete\.done/)).toBeInTheDocument();
  });

  it("presets the span from ?from= and ?until= but never deletes without the typed word", async () => {
    vi.spyOn(travTrackApi, "summary").mockResolvedValue({ ...HELD, pointCount: 3 });
    const del = vi.spyOn(travTrackApi, "deleteDays").mockResolvedValue(3);
    show(<TravTrackDeleteSection />, "/?from=2026-10-02&until=2026-10-02");
    expect(await screen.findByLabelText("settings:tt.delete.from")).toHaveValue("2026-10-02");
    expect(screen.getByLabelText("settings:tt.delete.until")).toHaveValue("2026-10-02");
    const button = await screen.findByRole("button", { name: "settings:tt.delete.do" });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByRole("button").pop()).toBeDisabled();
    expect(del).not.toHaveBeenCalled();
  });

  it("when the amount cannot be counted the button stays dead and nothing is deleted", async () => {
    vi.spyOn(travTrackApi, "summary").mockRejectedValue(failure());
    const del = vi.spyOn(travTrackApi, "deleteDays").mockResolvedValue(5);
    show(<TravTrackDeleteSection />);
    await screen.findByRole("button", { name: "settings:tt.delete.do" });
    await fillSpan();
    expect(await screen.findByText("track:errors.generic")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "settings:tt.delete.do" })).toBeDisabled();
    expect(del).not.toHaveBeenCalled();
  });

  it("a delete the server refuses says nothing was deleted and offers a retry", async () => {
    vi.spyOn(travTrackApi, "summary").mockResolvedValue({ ...HELD, pointCount: 5 });
    const del = vi.spyOn(travTrackApi, "deleteDays").mockRejectedValueOnce(failure());
    show(<TravTrackDeleteSection />);
    const button = await screen.findByRole("button", { name: "settings:tt.delete.do" });
    await fillSpan();
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByRole("textbox"), "settings:tt.delete.confirm.word");
    await userEvent.click(within(dialog).getAllByRole("button").pop()!);
    expect(await screen.findByText("track:errors.generic")).toBeInTheDocument();
    expect(del).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "settings:blocks.save.retry" })).toBeVisible();
  });

  it("stays reachable with TravTrack off on the server while data is held", async () => {
    caps.current = { ...ON, enabled: false, active: false, hasData: true };
    show(<TravTrackDeleteSection />);
    expect(
      await screen.findByRole("button", { name: "settings:tt.delete.do" })
    ).toBeInTheDocument();
  });

  it("is not drawn for an account without data when TravTrack is off", () => {
    caps.current = { ...ON, enabled: false, active: false, hasData: false };
    show(<TravTrackDeleteSection />);
    expect(screen.queryByRole("button", { name: "settings:tt.delete.do" })).toBeNull();
  });

  it("refuses a span that ends before it starts", async () => {
    show(<TravTrackDeleteSection />);
    await userEvent.type(await screen.findByLabelText("settings:tt.delete.from"), "2026-10-05");
    await userEvent.type(screen.getByLabelText("settings:tt.delete.until"), "2026-10-01");
    expect(screen.getByText("settings:tt.delete.invalidRange")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "settings:tt.delete.do" })).toBeDisabled();
  });
});

describe("Export", () => {
  it("offers the whole history by default and counts the points with the time zone", async () => {
    const summary = vi.spyOn(travTrackApi, "summary").mockResolvedValue(HELD);
    show(<TravTrackExportSection />);
    expect(await screen.findByTestId("export-count")).toHaveTextContent(/"count":12,"zone":"UTC"/);
    expect(screen.getByLabelText("settings:tt.export.from")).toHaveValue("2026-10-01");
    expect(summary).toHaveBeenCalledWith({ fromDay: "2026-10-01", toDay: "2026-10-03" });
    await userEvent.click(screen.getByRole("button", { name: "settings:tt.export.do" }));
    expect(await screen.findByTestId("export-dialog")).toHaveTextContent("2026-10-01..2026-10-03");
  });

  it("presets the span from ?from= and ?until=", async () => {
    vi.spyOn(travTrackApi, "summary").mockResolvedValue(HELD);
    show(<TravTrackExportSection />, "/?from=2026-10-02&until=2026-10-02");
    expect(await screen.findByLabelText("settings:tt.export.from")).toHaveValue("2026-10-02");
    await userEvent.click(await screen.findByRole("button", { name: "settings:tt.export.do" }));
    expect(await screen.findByTestId("export-dialog")).toHaveTextContent("2026-10-02..2026-10-02");
  });

  it("says when what is stored cannot be read, and offers no download", async () => {
    vi.spyOn(travTrackApi, "summary").mockRejectedValue(failure());
    show(<TravTrackExportSection />);
    expect(await screen.findByText("settings:tt.export.loadError")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "settings:tt.export.do" })).toBeDisabled();
  });

  it("stays reachable with TravTrack off on the server while data is held", async () => {
    caps.current = { ...ON, enabled: false, active: false };
    vi.spyOn(travTrackApi, "summary").mockResolvedValue(HELD);
    show(<TravTrackExportSection />);
    expect(await screen.findByRole("button", { name: "settings:tt.export.do" })).toBeEnabled();
  });
});
