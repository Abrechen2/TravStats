import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JSX, ReactNode } from "react";
import { LocationMapModal } from "../LocationMapModal";
import { reverseGeocode, searchPlaces } from "../../../lib/api/geo";
import type { PlaceSearchResult } from "../../../lib/api/geo";

vi.mock("../../../lib/api/geo", () => ({
  searchPlaces: vi.fn(),
  reverseGeocode: vi.fn(),
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
}
interface MockMarkerProps {
  children?: ReactNode;
  onDragEnd?: (e: { lngLat: { lng: number; lat: number } }) => void;
}

vi.mock("react-map-gl/maplibre", () => ({
  __esModule: true,
  default: ({ children, onClick }: MockMapProps): JSX.Element => (
    <div data-testid="mock-map" onClick={() => onClick?.({ lngLat: { lng: 13.38, lat: 52.516 } })}>
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
});
