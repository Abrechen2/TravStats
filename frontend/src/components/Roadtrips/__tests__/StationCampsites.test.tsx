import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import StationCampsites from "../StationCampsites";
import { openDataApi } from "../../../lib/api/openData";
import { useSettingsStore } from "../../../store/settingsStore";

vi.unmock("../../../store/settingsStore");
vi.mock("../../../lib/api/openData", async (orig) => ({
  ...(await orig<typeof import("../../../lib/api/openData")>()),
  openDataApi: { nearbyLodgings: vi.fn() },
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o?.km ? `${k}|${o.km}` : k),
    i18n: { language: "de" },
  }),
}));

const place = (name: string, kind: string, distanceM: number) => ({
  name,
  kind,
  lat: 46.5,
  lon: 11.3,
  distanceM,
  osmRef: `osm:node/${name}`,
  website: null,
  stars: null,
  brand: null,
  chain: null,
});

const press = (el: HTMLElement): Promise<void> =>
  act(async () => {
    fireEvent.click(el);
  });

describe("StationCampsites — campsites near a station via /nearby/lodging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ openDataEnabled: true } as never);
  });
  afterEach(cleanup);

  it("lists only campsites and pitches, nearest first, and hands the pick over", async () => {
    vi.mocked(openDataApi.nearbyLodgings).mockResolvedValue([
      place("Hotel Alpe", "hotel", 300),
      place("Camping Seeblick", "camp_site", 900),
      place("Stellplatz Dorf", "caravan_site", 2500),
    ]);
    const onPick = vi.fn();
    render(<StationCampsites point={{ lat: 46.4, lon: 11.2 }} onPick={onPick} />);
    await press(screen.getByRole("button"));
    expect(openDataApi.nearbyLodgings).toHaveBeenCalledWith(46.4, 11.2, 10);
    expect(screen.queryByText("Hotel Alpe")).toBeNull();
    expect(screen.getByText("Stellplatz Dorf")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Camping Seeblick"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ name: "Camping Seeblick" }));
  });

  it("tells 'none found' apart from 'OpenStreetMap did not answer'", async () => {
    vi.mocked(openDataApi.nearbyLodgings).mockResolvedValueOnce([place("Hotel", "hotel", 100)]);
    render(<StationCampsites point={{ lat: 1, lon: 2 }} onPick={vi.fn()} />);
    await press(screen.getByRole("button"));
    expect(screen.getByText("roadtrips:campsites.none|10")).toBeInTheDocument();

    vi.mocked(openDataApi.nearbyLodgings).mockRejectedValueOnce(
      Object.assign(new Error("502"), {
        isAxiosError: true,
        response: { status: 502, data: { code: "UPSTREAM_TIMEOUT" } },
      })
    );
    await press(screen.getByRole("button"));
    expect(screen.getByRole("alert")).toHaveTextContent("openData:lodging.upstream.timeout");
    expect(screen.queryByText("roadtrips:campsites.none|10")).toBeNull();
  });

  it("asks for a place first and stays out when open data is off", () => {
    const { rerender, container } = render(<StationCampsites point={null} onPick={vi.fn()} />);
    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByText("roadtrips:campsites.needPlace")).toBeInTheDocument();
    act(() => useSettingsStore.setState({ openDataEnabled: false } as never));
    rerender(<StationCampsites point={null} onPick={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
