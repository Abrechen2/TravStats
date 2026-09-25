import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LodgingFormModal } from "../LodgingFormModal";
import { createLodging, updateLodging } from "../../../lib/api/lodging";
import { openDataApi, type NearbyLodging } from "../../../lib/api/openData";
import { useSettingsStore } from "../../../store/settingsStore";
import type { Lodging, LodgingChain } from "../../../types/lodging";
import type { LocationSelection } from "../../location/LocationInput";

vi.unmock("../../../store/settingsStore");
vi.mock("../../../hooks/useLodgingEntrySuggestions", () => ({
  useLodgingEntrySuggestions: () => ({
    amenities: [
      { name: "Pool", usageCount: 3 },
      { name: "Parkplatz", usageCount: 1 },
    ],
    roomAmenities: [{ name: "Balkon", usageCount: 2 }],
  }),
}));
vi.mock("../../../lib/api/lodging", () => ({
  createLodging: vi.fn(),
  updateLodging: vi.fn(),
}));
vi.mock("../ChainPicker", () => ({
  ChainPicker: ({ value }: { value: LodgingChain | null }) => (
    <span data-testid="chain-value">{value?.name ?? "none"}</span>
  ),
}));
vi.mock("../../../lib/api/openData", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../lib/api/openData")>();
  return { ...original, openDataApi: { ...original.openDataApi, nearbyLodgings: vi.fn() } };
});

const SELECTION: LocationSelection = { lat: 52.5162, lon: 13.38 };

vi.mock("../../location/LocationInput", () => ({
  LocationInput: ({ onChange }: { onChange: (selection: LocationSelection) => void }) => (
    <button type="button" onClick={() => onChange(SELECTION)}>
      mock-select-location
    </button>
  ),
}));

const KEMPINSKI: LodgingChain = {
  id: 7,
  name: "Kempinski",
  brandColor: null,
  loyaltyProgram: "Kempinski Discovery",
  isUserAdded: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const ADLON: NearbyLodging = {
  name: "Adlon Kempinski",
  kind: "hotel",
  lat: 52.5163,
  lon: 13.3801,
  distanceM: 40,
  osmRef: "osm:node/1",
  website: "https://www.kempinski.com/adlon",
  stars: 5,
  brand: "Kempinski",
  chain: KEMPINSKI,
};

const CAMPING: NearbyLodging = {
  ...ADLON,
  name: "Stadtcamping",
  kind: "camp_site",
  osmRef: "osm:way/2",
  website: null,
  stars: null,
  brand: null,
  chain: null,
};

const baseLodging = {
  id: "lodging-1",
  userId: "user-1",
  type: "hotel",
  name: "Mein Adlon",
  chainId: null,
  chain: null,
  address: null,
  city: null,
  country: null,
  isoCountryCode: null,
  lat: null,
  lon: null,
  stars: null,
  amenities: [],
  visited: true,
  notes: null,
  website: null,
  dataSource: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  stays: [],
  overallRating: null,
  stayCount: 0,
  nights: 0,
  totalSpendBase: 0,
  totalSpendBaseByCurrency: {},
} as unknown as Lodging;

const SEARCH = "openData:lodging.nearby.search";

describe("LodgingFormModal — lodgings nearby from OpenStreetMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ betaFeaturesEnabled: true, openDataEnabled: true });
    vi.mocked(openDataApi.nearbyLodgings).mockResolvedValue([ADLON, CAMPING]);
  });

  it("is not offered while either switch is off, nor before a pin exists", async () => {
    useSettingsStore.setState({ betaFeaturesEnabled: true, openDataEnabled: false });
    const { unmount } = render(
      <LodgingFormModal mode="create" onClose={vi.fn()} onSaved={vi.fn()} />
    );
    await userEvent.click(screen.getByText("mock-select-location"));
    expect(screen.queryByText(SEARCH)).not.toBeInTheDocument();
    unmount();

    useSettingsStore.setState({ betaFeaturesEnabled: false, openDataEnabled: true });
    render(<LodgingFormModal mode="create" onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByText("mock-select-location"));
    expect(screen.queryByText(SEARCH)).not.toBeInTheDocument();
  });

  it("fills only the empty fields from the picked house, and keeps the user's name", async () => {
    vi.mocked(updateLodging).mockResolvedValue(baseLodging);
    render(
      <LodgingFormModal mode="edit" lodging={baseLodging} onClose={vi.fn()} onSaved={vi.fn()} />
    );
    expect(screen.queryByText(SEARCH)).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("mock-select-location"));
    await userEvent.click(screen.getByText(SEARCH));

    expect(openDataApi.nearbyLodgings).toHaveBeenCalledWith(52.5162, 13.38, 0.5);
    await userEvent.click(await screen.findByText("Adlon Kempinski"));
    expect(screen.getByTestId("chain-value")).toHaveTextContent("Kempinski");
    expect(screen.getByRole("status")).toHaveTextContent("openData:lodging.nearby.filled");

    await userEvent.click(screen.getByText("common:buttons.save"));
    await waitFor(() => expect(updateLodging).toHaveBeenCalled());
    const [, payload] = vi.mocked(updateLodging).mock.calls[0];
    expect(payload).toMatchObject({
      name: "Mein Adlon",
      stars: 5,
      website: "https://www.kempinski.com/adlon",
      chainId: 7,
      // An existing lodging's type is a recorded fact, not the select's default.
      type: "hotel",
    });
  });

  it("gives a new lodging the picked house's type until the user chooses one", async () => {
    vi.mocked(createLodging).mockResolvedValue(baseLodging);
    render(<LodgingFormModal mode="create" onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("lodging:field.stars"), "3");
    await userEvent.click(screen.getByText("mock-select-location"));
    await userEvent.click(screen.getByText(SEARCH));
    await userEvent.click(await screen.findByText("Stadtcamping"));

    expect((screen.getByLabelText("lodging:field.type") as HTMLSelectElement).value).toBe(
      "campsite"
    );
    await userEvent.selectOptions(screen.getByLabelText("lodging:field.type"), "guesthouse");
    await userEvent.click(screen.getByText(SEARCH));
    await userEvent.click(await screen.findByText("Adlon Kempinski"));

    await userEvent.click(screen.getByText("common:buttons.save"));
    await waitFor(() => expect(createLodging).toHaveBeenCalled());
    const [payload] = vi.mocked(createLodging).mock.calls[0];
    expect(payload).toMatchObject({
      name: "Stadtcamping",
      type: "guesthouse",
      // Typed before the pick; OSM's 5 does not replace it.
      stars: 3,
      website: "https://www.kempinski.com/adlon",
    });
  });

  it("says so when OpenStreetMap does not answer", async () => {
    vi.mocked(openDataApi.nearbyLodgings).mockRejectedValue(new Error("502"));
    render(<LodgingFormModal mode="create" onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByText("mock-select-location"));
    await userEvent.click(screen.getByText(SEARCH));
    expect(await screen.findByText("openData:lodging.nearby.failed")).toBeInTheDocument();
  });
});
