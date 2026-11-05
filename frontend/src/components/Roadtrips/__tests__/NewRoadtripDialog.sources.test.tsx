import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import NewRoadtripDialog from "../NewRoadtripDialog";
import { roadtripsApi } from "../../../lib/api/roadtrips";
import { listLodgings } from "../../../lib/api/lodging";
import { searchPlaces } from "../../../lib/api/geo";

vi.mock("../../../lib/api/roadtrips", () => ({
  roadtripsApi: { create: vi.fn(), replaceStations: vi.fn() },
}));
vi.mock("../../../lib/api/trips", () => ({
  tripsApi: { getAll: vi.fn(async () => [{ id: "t1", name: "Eine Reise" }]) },
}));
vi.mock("../../../lib/api/lodging", () => ({ listLodgings: vi.fn() }));
vi.mock("../../../lib/api/geo", () => ({ searchPlaces: vi.fn() }));
vi.mock("../../../hooks/useTagSuggestions", () => ({ useTagSuggestions: () => [] }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o?.name ? `${k}|${o.name}` : k),
    i18n: { language: "de" },
  }),
}));

const gpx = `<gpx><rte><rtept lat="48.1" lon="11.5"><name>München</name></rtept><rtept lat="45.4" lon="9.2"><name>Mailand</name></rtept></rte></gpx>`;

// jsdom's File has no text(); every browser's does.
const fileOf = (content: string, name: string): File => {
  const f = new File([content], name);
  Object.defineProperty(f, "text", { value: async () => content });
  return f;
};

// The file is read after the event returns, so the pick runs inside act().
const chooseFile = (file: File): Promise<void> =>
  act(async () => {
    fireEvent.change(screen.getByLabelText("roadtrips:startFrom.gpxChoose"), {
      target: { files: [file] },
    });
  });

/** The save has fully settled: the button is back to its label (and disabled once saved). */
const settled = (): Promise<void> =>
  waitFor(() =>
    expect(screen.getByText("roadtrips:newDialog.submit").closest("button")).toBeDisabled()
  );

/** A click whose handler starts async work: its follow-up state lands inside act(). */
const press = (el: HTMLElement): Promise<void> =>
  act(async () => {
    fireEvent.click(el);
  });

async function nameAndSubmit(): Promise<void> {
  fireEvent.change(screen.getByLabelText(/roadtrips:newDialog.name/), {
    target: { value: "Alpen" },
  });
  await press(screen.getByText("roadtrips:newDialog.submit").closest("button") as HTMLElement);
}

async function open(onCreated = vi.fn(), onReload = vi.fn()): Promise<void> {
  render(<NewRoadtripDialog open onClose={vi.fn()} onCreated={onCreated} onReload={onReload} />);
  // The trip list settles first, so no state update lands outside a test step.
  await screen.findByText("Eine Reise");
}

describe("NewRoadtripDialog — start from a lodging, a GPX file or a Maps link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(roadtripsApi.create).mockResolvedValue({ id: "new" } as never);
    vi.mocked(roadtripsApi.replaceStations).mockResolvedValue({} as never);
  });
  afterEach(cleanup);

  it("starts from a GPX file's route points and closes the loop on a round trip", async () => {
    const onCreated = vi.fn();
    await open(onCreated);
    fireEvent.click(screen.getByText("roadtrips:startFrom.gpx"));
    const file = fileOf(gpx, "alpen.gpx");
    await chooseFile(file);
    await screen.findByText("roadtrips:startFrom.gpxFrom.route");
    fireEvent.click(screen.getByRole("switch"));
    await nameAndSubmit();
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    await settled();
    const [, stations] = vi.mocked(roadtripsApi.replaceStations).mock.calls[0];
    expect(stations.map((s) => s.title)).toEqual(["München", "Mailand", "München"]);
    expect(stations.every((s) => s.night.kind === "pass")).toBe(true);
  });

  it("says why a file is refused and creates the roadtrip without invented stations", async () => {
    const onCreated = vi.fn();
    await open(onCreated);
    fireEvent.click(screen.getByText("roadtrips:startFrom.gpx"));
    await chooseFile(fileOf("<kml/>", "x.kml"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "roadtrips:startFrom.gpxError.notGpx"
    );
    expect(screen.getByRole("switch")).toBeDisabled();
    await nameAndSubmit();
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    await settled();
    expect(roadtripsApi.replaceStations).not.toHaveBeenCalled();
  });

  it("looks up a Maps link's named stops and names the one that is not found", async () => {
    vi.mocked(searchPlaces).mockImplementation(async (q: string) =>
      q === "Rom"
        ? { results: [], degraded: false }
        : { results: [{ name: q, lat: 46, lon: 11 }], degraded: false }
    );
    await open();
    fireEvent.click(screen.getByText("roadtrips:startFrom.link"));
    fireEvent.change(screen.getByLabelText(/roadtrips:startFrom.linkLabel/), {
      target: { value: "https://www.google.com/maps/dir/Verona/Rom/" },
    });
    await press(screen.getByText("roadtrips:startFrom.linkRead"));
    expect(await screen.findByRole("alert")).toHaveTextContent("linkError.notFound|Rom");
    expect(screen.queryByText("roadtrips:startFrom.preview")).not.toBeInTheDocument();
  });

  it("tells a geocoder outage apart from an unknown place", async () => {
    vi.mocked(searchPlaces).mockResolvedValue({ results: [], degraded: true });
    await open();
    fireEvent.click(screen.getByText("roadtrips:startFrom.link"));
    fireEvent.change(screen.getByLabelText(/roadtrips:startFrom.linkLabel/), {
      target: { value: "https://www.google.com/maps/dir/Verona/Rom/" },
    });
    await press(screen.getByText("roadtrips:startFrom.linkRead"));
    expect(await screen.findByRole("alert")).toHaveTextContent("linkError.unavailable|Verona");
  });

  it("offers every lodging of the library, shows a failed load as such, and starts at the pick", async () => {
    vi.mocked(listLodgings).mockRejectedValueOnce(new Error("down"));
    const onCreated = vi.fn();
    await open(onCreated);
    await press(screen.getByText("roadtrips:startFrom.lodging"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "roadtrips:startFrom.lodgingLoadFailed"
    );
    vi.mocked(listLodgings).mockResolvedValueOnce([
      { id: "l1", name: "Camping Alpe", city: "Bozen", country: "Italien", lat: 46.5, lon: 11.3 },
      { id: "l2", name: "Ohne Ort", city: null, country: null, lat: null, lon: null },
    ] as never);
    await press(screen.getByText("roadtrips:startFrom.retry"));
    fireEvent.click(await screen.findByText("Camping Alpe"));
    // A lodging with no coordinates is listed, but cannot be the start.
    expect(screen.getByText("Ohne Ort").closest("button")).toBeDisabled();
    await nameAndSubmit();
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    await settled();
    const [, stations] = vi.mocked(roadtripsApi.replaceStations).mock.calls[0];
    expect(stations).toEqual([
      { title: "Camping Alpe", lat: 46.5, lon: 11.3, night: { kind: "pass" } },
    ]);
  });

  it("does not open the roadtrip page when its stations could not be stored", async () => {
    vi.mocked(roadtripsApi.replaceStations).mockRejectedValue(new Error("500"));
    const onCreated = vi.fn();
    const onReload = vi.fn();
    await open(onCreated, onReload);
    fireEvent.click(screen.getByText("roadtrips:startFrom.gpx"));
    await chooseFile(fileOf(gpx, "a.gpx"));
    await screen.findByText("roadtrips:startFrom.gpxFrom.route");
    await nameAndSubmit();
    expect(await screen.findByText("roadtrips:startFrom.afterFailed")).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    expect(onReload).toHaveBeenCalled();
  });

  it("forgets the pick when the same source is chosen again, so the list never shows what is not sent", async () => {
    vi.mocked(listLodgings).mockResolvedValue([
      { id: "l1", name: "Camping Alpe", city: null, country: null, lat: 46.5, lon: 11.3 },
    ] as never);
    await open();
    await press(screen.getByText("roadtrips:startFrom.lodging"));
    await press(await screen.findByText("Camping Alpe"));
    expect(screen.getByText("roadtrips:startFrom.preview")).toBeInTheDocument();
    await press(screen.getByText("roadtrips:startFrom.lodging"));
    expect(screen.queryByText("roadtrips:startFrom.preview")).not.toBeInTheDocument();
    expect(screen.getByText("Camping Alpe").closest("button")).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });
});
