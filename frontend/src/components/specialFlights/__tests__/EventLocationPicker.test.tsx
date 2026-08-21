import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JSX, ReactNode } from "react";
import { EventLocationPicker } from "../EventLocationPicker";
import { searchPlaces } from "../../../lib/api/geo";
import type { PlaceSearchResult } from "../../../lib/api/geo";

// This is the CSP-fix seam test (Task 6): EventLocationPicker used to fetch
// `https://nominatim.openstreetmap.org` directly from the browser, which our
// `connect-src 'self'` CSP blocks in production. It must now go exclusively
// through `lib/api/geo.ts`'s same-origin proxy — never `global.fetch`.
vi.mock("../../../lib/api/geo", () => ({
  searchPlaces: vi.fn(),
  reverseGeocode: vi.fn().mockResolvedValue(null),
  reversePlaces: vi.fn().mockResolvedValue({ results: [], degraded: false }),
}));

vi.mock("../../../lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
    ready: true,
  }),
}));

// react-map-gl/maplibre needs real WebGL, unavailable in jsdom — mock the
// two pieces EventLocationPicker actually uses (Map + Marker), mirroring the
// LocationInput test's approach.
interface MockMapProps {
  children?: ReactNode;
  onClick?: (e: { lngLat: { lng: number; lat: number } }) => void;
}
interface MockMarkerProps {
  children?: ReactNode;
  onDragEnd?: (e: { lngLat: { lng: number; lat: number } }) => void;
}

vi.mock("react-map-gl/maplibre", () => ({
  __esModule: true,
  default: ({ children, onClick }: MockMapProps): JSX.Element => (
    <div data-testid="mock-map" onClick={() => onClick?.({ lngLat: { lng: 1.111, lat: 2.222 } })}>
      {children}
    </div>
  ),
  Marker: ({ children, onDragEnd }: MockMarkerProps): JSX.Element => (
    <div
      data-testid="mock-marker"
      onClick={(e) => {
        e.stopPropagation();
        onDragEnd?.({ lngLat: { lng: 9.999, lat: 8.888 } });
      }}
    >
      {children}
    </div>
  ),
}));

const zurich: PlaceSearchResult = {
  name: "Zürich",
  address: "Bahnhofstrasse 1",
  city: "Zürich",
  country: "Switzerland",
  countryCode: "CH",
  lat: 47.3769,
  lon: 8.5417,
  type: "city",
};

describe("EventLocationPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("searches via the same-origin api module (never a direct external fetch)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.mocked(searchPlaces).mockResolvedValue({ results: [zurich], degraded: false });
    const onChange = vi.fn();
    render(<EventLocationPicker value={{ lat: null, lon: null }} onChange={onChange} />);

    await userEvent.type(screen.getByLabelText("specialFlights:location.searchLabel"), "zuri");

    await waitFor(() => expect(searchPlaces).toHaveBeenCalledWith("zuri"), { timeout: 2000 });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("fills the coordinates when a suggestion is selected", async () => {
    vi.mocked(searchPlaces).mockResolvedValue({ results: [zurich], degraded: false });
    const onChange = vi.fn();
    render(<EventLocationPicker value={{ lat: null, lon: null }} onChange={onChange} />);

    await userEvent.type(screen.getByLabelText("specialFlights:location.searchLabel"), "zuri");
    const option = await screen.findByRole("option", { name: /Zürich/ });
    await userEvent.click(option);

    expect(onChange).toHaveBeenCalledWith({ lat: 47.3769, lon: 8.5417 });
  });

  it("shows the translated error state (not the raw error) when the search fails", async () => {
    vi.mocked(searchPlaces).mockRejectedValue(new Error("network exploded"));
    const onChange = vi.fn();
    render(<EventLocationPicker value={{ lat: null, lon: null }} onChange={onChange} />);

    await userEvent.type(screen.getByLabelText("specialFlights:location.searchLabel"), "berlin");

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByRole("alert")).toHaveTextContent("specialFlights:location.searchError");
    expect(screen.queryByText(/network exploded/)).not.toBeInTheDocument();
  });
});

/**
 * Owner request 2026-08-21: EVERY address input offers the shared map-pick
 * modal. The special-flight picker keeps its inline map (it is the widget's
 * centrepiece) and gains the modal as the roomy alternative.
 */
describe("EventLocationPicker — map-pick modal", () => {
  it("confirming a point in the modal reports it as the event location", async () => {
    const onChange = vi.fn();
    render(<EventLocationPicker value={{ lat: null, lon: null }} onChange={onChange} />);

    await userEvent.click(screen.getByText("location:mapPick"));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByTestId("mock-map"));
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText("location:mapModal.confirm"));
    expect(onChange).toHaveBeenCalledWith({ lat: 2.222, lon: 1.111 });
  });
});
