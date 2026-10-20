import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StayReviewCard from "../StayReviewCard";
import {
  dawarichStaysApi,
  type DawarichStay,
  type StayIdentity,
} from "../../../lib/api/dawarichStays";
import {
  installFakeIntersectionObserver,
  type FakeIntersectionObserverHandle,
} from "../../../pages/Admin/__tests__/intersectionObserverStub";

/**
 * A stay card names its place without manual input (forgejo#305): the probable
 * place fills an EMPTY, untouched name field, and never overwrites what the
 * user typed or picked.
 */

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../lib/api/dawarichStays", () => ({
  dawarichStaysApi: { accept: vi.fn(), reject: vi.fn(), identity: vi.fn(), placeType: vi.fn() },
}));
vi.mock("../../location/LocationMiniMap", () => ({
  default: () => <div data-testid="mini-map" />,
}));

const row: DawarichStay = {
  id: "finding",
  status: "pending",
  name: null,
  startAt: "2026-10-10T14:50:00Z",
  endAt: "2026-10-10T16:20:00Z",
  sourceStartAt: "2026-10-10T14:50:00Z",
  sourceEndAt: "2026-10-10T16:20:00Z",
  sourceLat: 38.7105,
  sourceLon: -9.1424,
  lat: 38.7105,
  lon: -9.1424,
  zone: "Europe/Lisbon",
  pointCount: 4,
  placeId: null,
  tripId: null,
  visitId: null,
  visit: null,
  detectedAt: "2026-10-11T00:00:00Z",
  resolvedAt: null,
  evidence: {
    source: "dawarich",
    zone: "Europe/Lisbon",
    pointIds: [1, 2, 3, 4],
    maxGapMinutes: 10,
    uncertainties: [],
  },
};
const identity: StayIdentity = {
  lat: 38.7105,
  lon: -9.1424,
  probable: { name: "A Brasileira", source: "nearbyPlace", photoSupported: false },
  address: { address: "Rua Garrett 120", city: "Lisboa", country: "Portugal" },
  geocoder: "ok",
  candidates: [
    {
      name: "Teatro São Carlos",
      type: "theatre",
      address: null,
      city: "Lisboa",
      lat: 38.7117,
      lon: -9.1424,
      distanceM: 133,
      photoCount: null,
    },
  ],
  candidatesState: "ok",
  photos: { state: "off", count: 0, cities: [], truncated: false },
  placeTypeAvailable: false,
};

let io: FakeIntersectionObserverHandle;
beforeEach(() => {
  vi.clearAllMocks();
  io = installFakeIntersectionObserver();
});
afterEach(() => io.restore());

const nameField = () => screen.getByLabelText("trips:dawarichStays.name");
const mount = (answer: StayIdentity = identity) => {
  let resolve: (value: StayIdentity) => void = () => {};
  vi.mocked(dawarichStaysApi.identity).mockReturnValue(
    new Promise<StayIdentity>((r) => {
      resolve = r;
    })
  );
  render(
    <MemoryRouter>
      <StayReviewCard row={row} choices={{ places: [], trips: [] }} onDone={vi.fn()} />
    </MemoryRouter>
  );
  act(() => io.observers[0].trigger(true));
  return async () => {
    await act(async () => resolve(answer));
    await screen.findByTestId("mini-map");
  };
};

describe("StayReviewCard — place identity", () => {
  it("fills the empty name with the probable place and accepts it", async () => {
    vi.mocked(dawarichStaysApi.accept).mockResolvedValue();
    const arrive = mount();
    await arrive();
    expect(nameField()).toHaveValue("A Brasileira");
    fireEvent.click(screen.getByRole("button", { name: "trips:dawarichStays.accept" }));
    await waitFor(() =>
      expect(dawarichStaysApi.accept).toHaveBeenCalledWith(
        "finding",
        expect.objectContaining({ name: "A Brasileira", lat: 38.7105, lon: -9.1424 })
      )
    );
  });

  it("never overwrites a name the user typed before the answer arrived", async () => {
    const arrive = mount();
    fireEvent.change(nameField(), { target: { value: "Coffee with Ana" } });
    await arrive();
    expect(nameField()).toHaveValue("Coffee with Ana");
  });

  it("does not use a photo city as the name of a visit", async () => {
    const arrive = mount({
      ...identity,
      probable: { name: "Lisboa", source: "photos", photoSupported: true },
    });
    await arrive();
    expect(nameField()).toHaveValue("");
  });

  it("takes a nearby place's name on request", async () => {
    const arrive = mount();
    await arrive();
    fireEvent.click(screen.getByRole("button", { name: "trips:dawarichStays.identity.useName" }));
    expect(nameField()).toHaveValue("Teatro São Carlos");
  });
});
