import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StayIdentityPanel from "../StayIdentityPanel";
import {
  dawarichStaysApi,
  type StayIdentity,
  type StayPlaceTypeResult,
} from "../../../lib/api/dawarichStays";
import {
  installFakeIntersectionObserver,
  type FakeIntersectionObserverHandle,
} from "../../../pages/Admin/__tests__/intersectionObserverStub";

/**
 * The stay card's place identification (forgejo#305) as the user sees it:
 * asked only once the card is on screen, and every failure shown as itself.
 */

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));
vi.mock("../../../lib/api/dawarichStays", () => ({
  dawarichStaysApi: { identity: vi.fn(), placeType: vi.fn() },
}));
vi.mock("../../location/LocationMiniMap", () => ({
  default: ({ value }: { value: { lat: number; lon: number } }) => (
    <div data-testid="mini-map" data-pin={`${value.lat},${value.lon}`} />
  ),
}));

const K = "trips:dawarichStays.identity";
const identityApi = vi.mocked(dawarichStaysApi.identity);
const placeTypeApi = vi.mocked(dawarichStaysApi.placeType);

const base: StayIdentity = {
  lat: 38.7105,
  lon: -9.1424,
  probable: { name: "A Brasileira", source: "nearbyPlace", photoSupported: false },
  address: { address: "Rua Garrett 120", city: "Lisboa", country: "Portugal" },
  geocoder: "ok",
  candidates: [
    {
      name: "A Brasileira",
      type: "cafe",
      address: null,
      city: "Lisboa",
      lat: 38.7107,
      lon: -9.1424,
      distanceM: 22,
      photoCount: null,
    },
  ],
  candidatesState: "ok",
  photos: { state: "notConfigured", count: 0, cities: [], truncated: false },
  placeTypeAvailable: false,
};

let io: FakeIntersectionObserverHandle;

beforeEach(() => {
  vi.clearAllMocks();
  io = installFakeIntersectionObserver();
});
afterEach(() => io.restore());

const show = (over: Partial<StayIdentity> = {}, onPickName?: (name: string) => void) => {
  identityApi.mockResolvedValue({ ...base, ...over });
  render(<StayIdentityPanel stayId="stay-1" lat={38.7105} lon={-9.1424} onPickName={onPickName} />);
};
const scrollIntoView = () => act(() => io.observers[0].trigger(true));
const scrollAway = () => act(() => io.observers[0].trigger(false));

describe("StayIdentityPanel", () => {
  it("asks nothing and draws no map until the card comes on screen, then asks once", async () => {
    show();
    expect(identityApi).not.toHaveBeenCalled();
    expect(screen.queryByTestId("mini-map")).toBeNull();

    scrollIntoView();
    expect(await screen.findByTestId("mini-map")).toHaveAttribute("data-pin", "38.7105,-9.1424");
    await screen.findByText("A Brasileira", { selector: "strong" });

    // Scrolled away the WebGL map is released; back on screen it is not asked again.
    scrollAway();
    expect(screen.queryByTestId("mini-map")).toBeNull();
    scrollIntoView();
    expect(identityApi).toHaveBeenCalledTimes(1);
  });

  it("names the place from Dawarich alone, with the address and nearby places", async () => {
    show();
    scrollIntoView();
    await screen.findByText("A Brasileira", { selector: "strong" });
    expect(screen.getByText(`(${K}.source.nearbyPlace)`)).toBeInTheDocument();
    expect(screen.getByText("Rua Garrett 120, Lisboa, Portugal")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: `${K}.candidates` })).toHaveTextContent(
      `A Brasileira · cafe · ${K}.distance {"meters":22}`
    );
    // No Immich connection is a choice, not a failure: nothing about photos.
    expect(screen.queryByText(new RegExp(`${K}.photos`))).toBeNull();
  });

  it("names the photos' city on Immich alone while both geocoders are down", async () => {
    show({
      probable: { name: "Lisboa", source: "photos", photoSupported: true },
      address: null,
      geocoder: "degraded",
      candidates: [],
      candidatesState: "degraded",
      photos: { state: "ok", count: 3, cities: [{ name: "Lisboa", count: 3 }], truncated: false },
    });
    scrollIntoView();
    await screen.findByText("Lisboa", { selector: "strong" });
    expect(screen.getByText(`(${K}.source.photos)`)).toBeInTheDocument();
    expect(screen.getByText(`${K}.geocoder.degraded`)).toBeInTheDocument();
    expect(screen.getByText(`${K}.candidatesState.degraded`)).toBeInTheDocument();
    expect(
      screen.getByText(`${K}.photos.count {"count":3} · ${K}.photos.cities {"cities":"Lisboa"}`)
    ).toBeInTheDocument();
  });

  it("says a photo-confirmed place was confirmed by the photos", async () => {
    show({
      probable: { name: "A Brasileira", source: "nearbyPlace", photoSupported: true },
      photos: { state: "ok", count: 2, cities: [], truncated: true },
    });
    scrollIntoView();
    expect(
      await screen.findByText(`(${K}.source.nearbyPlace, ${K}.photoSupported)`)
    ).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${K}.photos.truncated`))).toBeInTheDocument();
  });

  it.each(["unreachable", "auth"] as const)(
    "tells the user Immich %s, next to the place it still found",
    async (kind) => {
      show({ photos: { state: kind, count: 0, cities: [], truncated: false } });
      scrollIntoView();
      expect(await screen.findByText(`${K}.photos.failed.${kind}`)).toBeInTheDocument();
      expect(screen.getByText("A Brasileira", { selector: "strong" })).toBeInTheDocument();
    }
  );

  it("keeps a failed lookup apart from 'no address here'", async () => {
    show({ address: null, geocoder: "empty", candidates: [], candidatesState: "empty" });
    scrollIntoView();
    expect(await screen.findByText(`${K}.geocoder.empty`)).toBeInTheDocument();
    expect(screen.getByText(`${K}.candidatesState.empty`)).toBeInTheDocument();
  });

  it("names a rate limit as one and lets the user retry", async () => {
    identityApi.mockRejectedValueOnce({ response: { status: 429, data: {} } });
    show();
    scrollIntoView();
    expect(await screen.findByRole("alert")).toHaveTextContent(`${K}.error.rateLimited`);
    await userEvent.click(screen.getByRole("button", { name: `${K}.retry` }));
    await screen.findByText("A Brasileira", { selector: "strong" });
    expect(identityApi).toHaveBeenCalledTimes(2);
  });

  it("names an unreachable server as unavailable, not as 'no place'", async () => {
    identityApi.mockRejectedValueOnce(new Error("Network Error"));
    show();
    scrollIntoView();
    expect(await screen.findByRole("alert")).toHaveTextContent(`${K}.error.unavailable`);
    expect(screen.queryByText(`${K}.noProbable`)).toBeNull();
  });

  it("hands a nearby place's name to the form when asked", async () => {
    const pick = vi.fn();
    show({}, pick);
    scrollIntoView();
    await userEvent.click(await screen.findByRole("button", { name: `${K}.useName` }));
    expect(pick).toHaveBeenCalledWith("A Brasileira");
  });

  it("offers no name button once the finding cannot be edited", async () => {
    show();
    scrollIntoView();
    await screen.findByText("A Brasileira", { selector: "strong" });
    expect(screen.queryByRole("button", { name: `${K}.useName` })).toBeNull();
  });

  describe("place type", () => {
    const withType = async (result: StayPlaceTypeResult | Error) => {
      if (result instanceof Error) placeTypeApi.mockRejectedValue(result);
      else placeTypeApi.mockResolvedValue(result);
      show({ placeTypeAvailable: true });
      scrollIntoView();
      await screen.findByTestId("mini-map");
    };

    it("is not asked when the account did not switch it on", async () => {
      show();
      scrollIntoView();
      await screen.findByText("A Brasileira", { selector: "strong" });
      expect(placeTypeApi).not.toHaveBeenCalled();
    });

    it("shows the type, and which cloud host determined it", async () => {
      await withType({
        state: "ok",
        type: "cafe",
        provider: { kind: "openai", isCloud: true, host: "api.openai.com" },
      });
      expect(await screen.findByText(`${K}.placeType.types.cafe`)).toBeInTheDocument();
      expect(
        screen.getByText(new RegExp(`${K}.placeType.viaCloud.*api\\.openai\\.com`))
      ).toBeInTheDocument();
    });

    it.each([
      [{ state: "refused", refusal: "cloud_not_consented" }, "refused.cloud_not_consented"],
      [{ state: "failed", failure: "timeout" }, "failed.timeout"],
      [{ state: "failed", failure: "unusable" }, "failed.unusable"],
    ] as const)("says why it is missing: %o", async (result, key) => {
      await withType(result);
      expect(await screen.findByText(`${K}.placeType.${key}`)).toBeInTheDocument();
    });

    it("names a failed request as an unreachable model", async () => {
      await withType(new Error("timeout of 50000ms exceeded"));
      expect(await screen.findByText(`${K}.placeType.failed.unavailable`)).toBeInTheDocument();
    });

    it("draws nothing when there is nothing to classify", async () => {
      await withType({ state: "noCandidates" });
      await waitFor(() => expect(placeTypeApi).toHaveBeenCalled());
      await waitFor(() =>
        expect(screen.queryByText(`${K}.placeType.loading`)).not.toBeInTheDocument()
      );
      expect(screen.queryByText(new RegExp(`${K}.placeType`))).toBeNull();
    });
  });
});
