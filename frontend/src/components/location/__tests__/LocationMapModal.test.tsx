import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import type { JSX, ReactNode } from "react";
import { LocationMapModal } from "../LocationMapModal";
import { reverseGeocode, reversePlaces, searchPlaces } from "../../../lib/api/geo";
import type { PlaceSearchResult } from "../../../lib/api/geo";

vi.mock("../../../lib/api/geo", () => ({
  searchPlaces: vi.fn(),
  reverseGeocode: vi.fn(),
  reversePlaces: vi.fn(),
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

interface MockMapProps {
  children?: ReactNode;
  onClick?: (e: { lngLat: { lng: number; lat: number } }) => void;
  /** Read ONCE at mount by react-map-gl — the mock exposes it so a test can
   *  assert which section of the world the picker actually opened on. */
  initialViewState?: { longitude: number; latitude: number; zoom: number };
}
interface MockMarkerProps {
  children?: ReactNode;
  onDragEnd?: (e: { lngLat: { lng: number; lat: number } }) => void;
}

/**
 * react-map-gl treats `initialViewState` as UNCONTROLLED: it is read once, at
 * mount, and later changes are ignored. The mock freezes it the same way — one
 * that re-read it on every render would report the corrected viewport of the
 * second render and hide exactly the one-render lag this suite exists to catch.
 */
function MockMap({ children, onClick, initialViewState }: MockMapProps): JSX.Element {
  const frozen = useRef(initialViewState);
  const v = frozen.current;
  return (
    <div
      data-testid="mock-map"
      data-initial-view={v ? `${v.longitude},${v.latitude},${v.zoom}` : ""}
      onClick={() => onClick?.({ lngLat: { lng: 13.38, lat: 52.516 } })}
    >
      {children}
    </div>
  );
}

vi.mock("react-map-gl/maplibre", () => ({
  __esModule: true,
  default: MockMap,
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

const adlon = {
  name: "Hotel Adlon Kempinski",
  address: "Unter den Linden 77",
  city: "Berlin",
  country: "Deutschland",
};

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

describe("LocationMapModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reverseGeocode).mockResolvedValue(null);
    vi.mocked(reversePlaces).mockResolvedValue({ results: [], degraded: false });
  });

  it("renders nothing while closed", () => {
    render(
      <LocationMapModal open={false} value={null} onClose={vi.fn()} onConfirm={vi.fn()} />
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a map click sets the pin and confirm reports the coordinates", async () => {
    const onConfirm = vi.fn();
    render(
      <LocationMapModal open={true} value={null} onClose={vi.fn()} onConfirm={onConfirm} />
    );

    await userEvent.click(screen.getByTestId("mock-map"));
    await userEvent.click(screen.getByText("location:mapModal.confirm"));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 52.516, lon: 13.38 })
    );
  });

  it("reverse-geocodes the pin and confirm carries the resolved address", async () => {
    vi.mocked(reverseGeocode).mockResolvedValue(adlon);
    const onConfirm = vi.fn();
    render(
      <LocationMapModal open={true} value={null} onClose={vi.fn()} onConfirm={onConfirm} />
    );

    await userEvent.click(screen.getByTestId("mock-map"));

    await waitFor(() => expect(reverseGeocode).toHaveBeenCalledWith(52.516, 13.38), {
      timeout: 2000,
    });
    // The resolved address is SHOWN before it can be confirmed — that display
    // is what makes overwriting a typed address an informed act.
    await screen.findByText(/Unter den Linden 77/);

    await userEvent.click(screen.getByText("location:mapModal.confirm"));
    expect(onConfirm).toHaveBeenCalledWith({
      lat: 52.516,
      lon: 13.38,
      name: "Hotel Adlon Kempinski",
      address: "Unter den Linden 77",
      city: "Berlin",
      country: "Deutschland",
    });
  });

  it("a search hit inside the modal sets the pin and wins over reverse parts", async () => {
    vi.mocked(searchPlaces).mockResolvedValue({ results: [zurich], degraded: false });
    vi.mocked(reverseGeocode).mockResolvedValue(adlon);
    const onConfirm = vi.fn();
    render(
      <LocationMapModal open={true} value={null} onClose={vi.fn()} onConfirm={onConfirm} />
    );

    await userEvent.type(screen.getByRole("combobox"), "zuri");
    const option = await screen.findByRole("option", { name: /Zürich/ });
    await userEvent.click(option);

    await userEvent.click(screen.getByText("location:mapModal.confirm"));
    expect(onConfirm).toHaveBeenCalledWith({
      lat: 47.3769,
      lon: 8.5417,
      name: "Zürich",
      address: "Bahnhofstrasse 1",
      city: "Zürich",
      country: "Switzerland",
      countryCode: "CH",
    });
  });

  it("cancel closes without confirming", async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(
      <LocationMapModal open={true} value={null} onClose={onClose} onConfirm={onConfirm} />
    );

    await userEvent.click(screen.getByText("location:mapModal.cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirm is disabled until a pin exists", () => {
    render(<LocationMapModal open={true} value={null} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText("location:mapModal.confirm")).toBeDisabled();
  });

  it("opens seeded with an existing position, confirmable as-is", async () => {
    const onConfirm = vi.fn();
    render(
      <LocationMapModal
        open={true}
        value={{ lat: 10, lon: 20 }}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    await userEvent.click(screen.getByText("location:mapModal.confirm"));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ lat: 10, lon: 20 }));
  });

  describe("nearby-POI selection (Google-Maps-like)", () => {
    const adlonPoi: PlaceSearchResult = {
      name: "Hotel Adlon Kempinski",
      address: "Unter den Linden 77",
      city: "Berlin",
      country: "Deutschland",
      countryCode: "DE",
      lat: 52.5163,
      lon: 13.3803,
      type: "hotel",
    };
    const bahnhofPoi: PlaceSearchResult = {
      name: "Bahnhof Brandenburger Tor",
      city: "Berlin",
      country: "Deutschland",
      countryCode: "DE",
      lat: 52.5162,
      lon: 13.3812,
      type: "station",
    };

    it("lists the nearby places after a map click", async () => {
      vi.mocked(reversePlaces).mockResolvedValue({
        results: [adlonPoi, bahnhofPoi],
        degraded: false,
      });
      render(
        <LocationMapModal open={true} value={null} onClose={vi.fn()} onConfirm={vi.fn()} />
      );

      await userEvent.click(screen.getByTestId("mock-map"));

      expect(await screen.findByText("Hotel Adlon Kempinski")).toBeInTheDocument();
      expect(screen.getByText("Bahnhof Brandenburger Tor")).toBeInTheDocument();
    });

    it("picking a place makes confirm report its full fields", async () => {
      vi.mocked(reversePlaces).mockResolvedValue({ results: [adlonPoi], degraded: false });
      const onConfirm = vi.fn();
      render(
        <LocationMapModal open={true} value={null} onClose={vi.fn()} onConfirm={onConfirm} />
      );

      await userEvent.click(screen.getByTestId("mock-map"));
      await userEvent.click(await screen.findByText("Hotel Adlon Kempinski"));
      await userEvent.click(screen.getByText("location:mapModal.confirm"));

      expect(onConfirm).toHaveBeenCalledWith({
        lat: 52.5163,
        lon: 13.3803,
        name: "Hotel Adlon Kempinski",
        address: "Unter den Linden 77",
        city: "Berlin",
        country: "Deutschland",
        countryCode: "DE",
      });
    });

    it("a new map click clears the picked place again", async () => {
      vi.mocked(reversePlaces).mockResolvedValue({ results: [adlonPoi], degraded: false });
      const onConfirm = vi.fn();
      render(
        <LocationMapModal open={true} value={null} onClose={vi.fn()} onConfirm={onConfirm} />
      );

      await userEvent.click(screen.getByTestId("mock-map"));
      await userEvent.click(await screen.findByText("Hotel Adlon Kempinski"));
      await userEvent.click(screen.getByTestId("mock-map"));
      await userEvent.click(screen.getByText("location:mapModal.confirm"));

      expect(onConfirm).toHaveBeenCalledWith(
        expect.not.objectContaining({ name: "Hotel Adlon Kempinski" })
      );
    });

    it("shows no list when nothing is nearby", async () => {
      vi.mocked(reversePlaces).mockResolvedValue({ results: [], degraded: false });
      render(
        <LocationMapModal open={true} value={null} onClose={vi.fn()} onConfirm={vi.fn()} />
      );

      await userEvent.click(screen.getByTestId("mock-map"));
      await new Promise((r) => setTimeout(r, 700));

      expect(screen.queryByTestId("map-modal-poi-list")).not.toBeInTheDocument();
    });
  });
  describe("the section of the world it opens on", () => {
    it("opens on an existing point, even when that point arrived while it was shut", async () => {
      // The real sequence: the form mounts the modal closed and without a
      // position, the position arrives (a stay is loaded, or an address is
      // geocoded), and only then does the user open the picker. The map reads
      // its viewport ONCE at mount, so a one-render lag leaves it on the world
      // view with the pin somewhere off screen.
      const { rerender } = render(
        <LocationMapModal open={false} value={null} onClose={vi.fn()} onConfirm={vi.fn()} />
      );

      rerender(
        <LocationMapModal
          open={true}
          value={{ lat: 47.3769, lon: 8.5417 }}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
        />
      );

      expect(screen.getByTestId("mock-map").getAttribute("data-initial-view")).toBe(
        "8.5417,47.3769,9"
      );
    });

    it("opens on the world view when there is no point yet", () => {
      render(<LocationMapModal open={true} value={null} onClose={vi.fn()} onConfirm={vi.fn()} />);

      expect(screen.getByTestId("mock-map").getAttribute("data-initial-view")).toBe("10,50,3");
    });
  });

  describe("what is here — after a search hit too", () => {
    it("lists the places around a pin the SEARCH placed", async () => {
      // Knowing the name of the place you searched for says nothing about what
      // stands around it. The address may already be known; the neighbours are
      // not, and finding a hotel is exactly the search-first path.
      vi.mocked(searchPlaces).mockResolvedValue({ results: [zurich], degraded: false });
      vi.mocked(reversePlaces).mockResolvedValue({
        results: [{ ...zurich, name: "Hotel St. Gotthard" }],
        degraded: false,
      });
      render(<LocationMapModal open={true} value={null} onClose={vi.fn()} onConfirm={vi.fn()} />);

      await userEvent.type(screen.getByRole("combobox"), "Zurich");
      await userEvent.click(await screen.findByText(/Zürich/));

      await waitFor(() => expect(reversePlaces).toHaveBeenCalledWith(47.3769, 8.5417, "en"), {
        timeout: 2000,
      });
      expect(await screen.findByText("Hotel St. Gotthard")).toBeInTheDocument();
    });

    it("keeps the search hit's own address as the line under the map", async () => {
      // The list is an offer, not an override: until a place is tapped, the
      // hit the user chose stays the answer.
      vi.mocked(searchPlaces).mockResolvedValue({ results: [zurich], degraded: false });
      vi.mocked(reversePlaces).mockResolvedValue({
        results: [{ ...zurich, name: "Hotel St. Gotthard" }],
        degraded: false,
      });
      const onConfirm = vi.fn();
      render(<LocationMapModal open={true} value={null} onClose={vi.fn()} onConfirm={onConfirm} />);

      await userEvent.type(screen.getByRole("combobox"), "Zurich");
      await userEvent.click(await screen.findByText(/Zürich/));
      await screen.findByText("Hotel St. Gotthard");

      await userEvent.click(screen.getByText("location:mapModal.confirm"));
      expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ name: "Zürich" }));
    });
  });
});
