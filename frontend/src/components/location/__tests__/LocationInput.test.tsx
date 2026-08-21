import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JSX, ReactNode } from "react";
import { LocationInput } from "../LocationInput";
import { searchPlaces } from "../../../lib/api/geo";
import { logger } from "../../../lib/logger";
import type { PlaceSearchResult } from "../../../lib/api/geo";

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
// two pieces LocationInput actually uses (Map + Marker) with plain divs that
// forward the click/drag callbacks LocationInput wires up.
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
        // Real react-map-gl markers don't bubble a drag into the parent
        // Map's onClick — stop propagation so this mock behaves the same,
        // otherwise both handlers would fire for one click.
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

describe("LocationInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders fine with value=null and no map open (cheap default state)", () => {
    render(<LocationInput value={null} onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-map")).not.toBeInTheDocument();
  });

  it("searches as the user types and fills every field on selection", async () => {
    vi.mocked(searchPlaces).mockResolvedValue({ results: [zurich], degraded: false });
    const onChange = vi.fn();
    render(<LocationInput value={null} onChange={onChange} />);

    await userEvent.type(screen.getByRole("combobox"), "zuri");
    await waitFor(() => expect(searchPlaces).toHaveBeenCalledWith("zuri", "en"), {
      timeout: 2000,
    });

    const option = await screen.findByRole("option", { name: /Zürich/ });
    await userEvent.click(option);

    expect(onChange).toHaveBeenCalledWith({
      lat: 47.3769,
      lon: 8.5417,
      name: "Zürich",
      address: "Bahnhofstrasse 1",
      city: "Zürich",
      country: "Switzerland",
      countryCode: "CH",
    });
  });

  it("splits a pasted coordinate pair without calling search (THE spec assertion)", async () => {
    const onChange = vi.fn();
    render(<LocationInput value={null} onChange={onChange} />);

    await userEvent.type(screen.getByRole("combobox"), "47.3769, 8.5417");

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ lat: 47.3769, lon: 8.5417 }));
    expect(await screen.findByTestId("location-input-coords-detected")).toBeInTheDocument();
    expect(searchPlaces).not.toHaveBeenCalled();
  });

  it("shows a translated inline error and logs when the search fails, form stays usable", async () => {
    vi.mocked(searchPlaces).mockRejectedValue(new Error("network exploded"));
    const onChange = vi.fn();
    render(<LocationInput value={null} onChange={onChange} />);

    const input = screen.getByRole("combobox");
    await userEvent.type(input, "berlin");

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument(), {
      timeout: 2000,
    });
    expect(screen.getByRole("alert")).toHaveTextContent("location:searchError");
    expect(logger.error).toHaveBeenCalled();

    // The raw Error message must never reach the user-facing text.
    expect(screen.queryByText(/network exploded/)).not.toBeInTheDocument();

    // Form stays usable: input is still editable, coordinate paste still works.
    await userEvent.clear(input);
    await userEvent.type(input, "47.3769, 8.5417");
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ lat: 47.3769, lon: 8.5417 }));
  });

  it("supports keyboard navigation of the suggestion dropdown", async () => {
    const secondHit: PlaceSearchResult = { ...zurich, name: "Zürichberg", lat: 47.38, lon: 8.55 };
    vi.mocked(searchPlaces).mockResolvedValue({ results: [zurich, secondHit], degraded: false });
    const onChange = vi.fn();
    render(<LocationInput value={null} onChange={onChange} />);

    const input = screen.getByRole("combobox");
    await userEvent.type(input, "zuri");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2), { timeout: 2000 });

    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ name: "Zürichberg" }));
  });

  // The inline mini-map is gone (owner decision 2026-08-21): the ONE map way
  // is the modal. Nothing reaches the parent before "Übernehmen".
  it("picks a point through the map modal — confirm reports, cancel discards", async () => {
    const onChange = vi.fn();
    render(<LocationInput value={{ lat: 10, lon: 20 }} onChange={onChange} />);

    await userEvent.click(screen.getByText("location:mapPick"));
    const map = await screen.findByTestId("mock-map");
    await userEvent.click(map);
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText("location:mapModal.confirm"));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ lat: 2.222, lon: 1.111 })
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("cancelling the map modal changes nothing", async () => {
    const onChange = vi.fn();
    render(<LocationInput value={null} onChange={onChange} />);

    await userEvent.click(screen.getByText("location:mapPick"));
    await userEvent.click(screen.getByTestId("mock-map"));
    await userEvent.click(screen.getByText("location:mapModal.cancel"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("round-trips through the advanced raw lat/lon panel, seeded from an existing value", async () => {
    const onChange = vi.fn();
    render(<LocationInput value={{ lat: 47.3769, lon: 8.5417 }} onChange={onChange} />);

    await userEvent.click(screen.getByText("location:advanced"));
    const latInput = screen.getByLabelText("location:field.lat") as HTMLInputElement;
    const lonInput = screen.getByLabelText("location:field.lon") as HTMLInputElement;
    expect(latInput.value).toBe("47.3769");
    expect(lonInput.value).toBe("8.5417");

    await userEvent.clear(latInput);
    await userEvent.type(latInput, "10");
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ lat: 10, lon: 8.5417 }));
  });

  it("never fetches an external host directly — only the api module is called", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.mocked(searchPlaces).mockResolvedValue({ results: [zurich], degraded: false });
    const onChange = vi.fn();
    render(<LocationInput value={null} onChange={onChange} />);

    await userEvent.type(screen.getByRole("combobox"), "zuri");
    await waitFor(() => expect(searchPlaces).toHaveBeenCalled(), { timeout: 2000 });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
