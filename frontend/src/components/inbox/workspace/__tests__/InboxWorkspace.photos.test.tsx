import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import InboxWorkspace from "../InboxWorkspace";
import { dataQualityFlagsApi } from "../../../../lib/api/dataQualityFlags";
import { tripSuggestionsApi } from "../../../../lib/api/tripSuggestions";
import { pendingUpdatesApi } from "../../../../lib/api/pendingUpdates";
import { photoJourneysApi } from "../../../../lib/api/photoJourneys";
import { tripsApi } from "../../../../lib/api/trips";
import { immichApi } from "../../../../lib/api/immich";
import { createVisit } from "../../../../lib/api/places";
import type { PhotoJourney } from "../../../../types/photoJourney";

/**
 * The photo suggestions in the one inbox — what the old "Foto-Reisen" tab did,
 * held against the card that replaced it:
 *
 * - **The strip is addressed by index.** An `<img src>` carrying an asset id
 *   would 404 on every thumbnail — and if the proxy ever accepted an id, it
 *   would be a reader for the whole Immich. The row is the grant.
 * - **Accept creates before it answers, and the right thing per reading.**
 * - **The scan is offered only where it can run** (`hasAccess` is the resolver
 *   the scan itself calls), and its status is asked only when the photo filter
 *   is on screen.
 *
 * The global test setup makes `t` return its key.
 */

vi.mock("../../../../lib/api/dataQualityFlags", () => ({
  dataQualityFlagsApi: { getAll: vi.fn(), run: vi.fn(), dismiss: vi.fn(), resolve: vi.fn() },
}));
vi.mock("../../../../lib/api/tripSuggestions", () => ({
  tripSuggestionsApi: { list: vi.fn(), accept: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("../../../../lib/api/pendingUpdates", () => ({
  pendingUpdatesApi: { getAll: vi.fn(), apply: vi.fn(), update: vi.fn(), reject: vi.fn() },
}));
// `importOriginal` keeps `photoJourneyPreviewUrl` real: it is under test.
vi.mock("../../../../lib/api/photoJourneys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/api/photoJourneys")>();
  return {
    ...actual,
    photoJourneysApi: {
      list: vi.fn(),
      scan: vi.fn(),
      accept: vi.fn(),
      dismiss: vi.fn(),
      review: vi.fn(),
    },
  };
});
vi.mock("../../../../lib/api/trips", () => ({ tripsApi: { getAll: vi.fn(), create: vi.fn() } }));
vi.mock("../../../../lib/api/places", () => ({ createVisit: vi.fn(), listPlaces: vi.fn() }));
vi.mock("../../../../lib/api/dawarichStays", () => ({
  dawarichStaysApi: { list: vi.fn(async () => []), choices: vi.fn() },
}));
vi.mock("../../../../lib/api/immich", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/api/immich")>()),
  immichApi: { getSettings: vi.fn() },
}));
vi.mock("../../../GlobeLoader", () => ({ GlobeLoader: () => null }));

const addToast = vi.fn();
const toastState = { addToast: (...args: unknown[]) => addToast(...args) };
vi.mock("../../../../store/toastStore", () => ({
  useToastStore: (selector: (s: typeof toastState) => unknown) => selector(toastState),
}));

const W = "dataQuality:inbox.workspace";
const K = "dataQuality:inbox.photoJourneys";

function makeJourney(over: Partial<PhotoJourney> = {}): PhotoJourney {
  return {
    id: "journey-1",
    status: "pending",
    kind: "trip",
    startDate: "2026-04-02T08:00:00.000Z",
    endDate: "2026-04-06T19:00:00.000Z",
    startDay: "2026-04-02",
    endDay: "2026-04-06",
    photoCount: 42,
    locatedCount: 40,
    lat: 38.7223,
    lon: -9.1393,
    countryCode: "PT",
    countryName: "Portugal",
    city: "Lissabon",
    previewAssetIds: [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
    ],
    placeId: null,
    distanceKm: 12.5,
    nights: 4,
    airportIata: "LIS",
    spreadKm: 30,
    createdTripId: null,
    createdPlaceVisitId: null,
    createdLodgingStayId: null,
    resolvedAt: null,
    createdAt: "2026-04-07T03:00:00.000Z",
    ...over,
  };
}

async function mount(rows: PhotoJourney[], hasAccess = true, url = "/pending-updates?tab=photos") {
  vi.mocked(photoJourneysApi.list).mockResolvedValue(rows);
  vi.mocked(immichApi.getSettings).mockResolvedValue({
    baseUrl: hasAccess ? "https://immich.example" : null,
    hasKey: hasAccess,
    defaultMode: "link",
    source: hasAccess ? "user" : null,
    isShared: false,
    hasAccess,
  });
  render(
    <MemoryRouter initialEntries={[url]}>
      <InboxWorkspace photosVisible />
    </MemoryRouter>
  );
  await waitFor(() => expect(photoJourneysApi.list).toHaveBeenCalledWith("pending"));
  await screen.findByText(`${W}.shown`);
}

const accept = (plan: string) => `${W}.acceptPhoto.${plan}`;

describe("photo suggestions in the inbox", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(dataQualityFlagsApi.getAll).mockResolvedValue({ flags: [], count: 0 });
    vi.mocked(tripSuggestionsApi.list).mockResolvedValue({
      suggestions: [],
      total: 0,
      home: "history",
      truncated: false,
    });
    vi.mocked(pendingUpdatesApi.getAll).mockResolvedValue({ updates: [], count: 0 });
    vi.mocked(tripsApi.getAll).mockResolvedValue([]);
  });

  it("draws the preview strip from the row id and the INDEX, never from an asset id", async () => {
    const journey = makeJourney();
    await mount([journey]);
    const images = await screen.findAllByRole("img");
    expect(images).toHaveLength(4);
    images.forEach((img, index) => {
      expect(img).toHaveAttribute(
        "src",
        `/api/v1/photo-journeys/journey-1/preview/${index}/file?size=thumbnail`
      );
    });
    const sources = images.map((img) => img.getAttribute("src") ?? "");
    journey.previewAssetIds.forEach((assetId) => {
      expect(sources.some((src) => src.includes(assetId))).toBe(false);
    });
  });

  it("accepting a trip finding creates the trip on the photo days FIRST, then links it", async () => {
    vi.mocked(tripsApi.create).mockResolvedValue({ id: "trip-9" } as never);
    await mount([makeJourney()]);
    vi.mocked(photoJourneysApi.list).mockResolvedValue([]);
    await userEvent.click(screen.getByRole("button", { name: accept("trip") }));

    await waitFor(() =>
      expect(tripsApi.create).toHaveBeenCalledWith({
        name: "Lissabon, Portugal",
        startDate: "2026-04-02",
        endDate: "2026-04-06",
      })
    );
    expect(photoJourneysApi.accept).toHaveBeenCalledWith("journey-1", { createdTripId: "trip-9" });
    expect(createVisit).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("success", `${K}.messages.accepted.trip`)
    );
    await waitFor(() => expect(screen.queryAllByRole("img")).toHaveLength(0));
  });

  it("accepting a place finding records a visit at that place, and says how many photos came along", async () => {
    vi.mocked(createVisit).mockResolvedValue({ id: "visit-3" } as never);
    vi.mocked(photoJourneysApi.accept).mockResolvedValue({ kind: "linked", linked: 3, skipped: 1 });
    await mount([makeJourney({ kind: "place", placeId: "place-7", airportIata: null })]);
    await userEvent.click(screen.getByRole("button", { name: accept("placeVisit") }));

    await waitFor(() =>
      expect(createVisit).toHaveBeenCalledWith("place-7", { visitedAt: "2026-04-02T08:00:00.000Z" })
    );
    expect(photoJourneysApi.accept).toHaveBeenCalledWith("journey-1", {
      createdPlaceVisitId: "visit-3",
    });
    expect(tripsApi.create).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("success", `${K}.messages.photosLinked`)
    );
  });

  it("warns when the photo library was down while the place finding was accepted", async () => {
    vi.mocked(createVisit).mockResolvedValue({ id: "visit-3" } as never);
    vi.mocked(photoJourneysApi.accept).mockResolvedValue({ kind: "failed", reason: "unreachable" });
    await mount([makeJourney({ kind: "place", placeId: "place-7", airportIata: null })]);
    await userEvent.click(screen.getByRole("button", { name: accept("placeVisit") }));
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("warning", `${K}.messages.photosNotLinked`)
    );
  });

  it("accepting a stay finding creates nothing — a stay needs a lodging the row does not name", async () => {
    await mount([makeJourney({ kind: "stay", placeId: "place-7" })]);
    await userEvent.click(screen.getByRole("button", { name: accept("stayAnswerOnly") }));
    await waitFor(() => expect(photoJourneysApi.accept).toHaveBeenCalledWith("journey-1"));
    expect(tripsApi.create).not.toHaveBeenCalled();
    expect(createVisit).not.toHaveBeenCalled();
  });

  it("dismissing answers the one endpoint, confirms, and drops the row", async () => {
    await mount([makeJourney()]);
    vi.mocked(photoJourneysApi.list).mockResolvedValue([]);
    await userEvent.click(screen.getByRole("button", { name: `${W}.dismissPhoto` }));
    await waitFor(() => expect(photoJourneysApi.dismiss).toHaveBeenCalledWith("journey-1"));
    expect(photoJourneysApi.accept).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith("success", `${K}.messages.dismissed`);
    await waitFor(() => expect(screen.queryAllByRole("img")).toHaveLength(0));
  });

  it("keeps each card's buttons disabled on its OWN answer, not on a sibling's", async () => {
    let releaseCreate: (() => void) | undefined;
    vi.mocked(tripsApi.create).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseCreate = () => resolve({ id: "trip-9" } as never);
        })
    );
    vi.mocked(photoJourneysApi.dismiss).mockResolvedValue(undefined);
    await mount([makeJourney(), makeJourney({ id: "journey-2" })]);

    await userEvent.click(screen.getAllByRole("button", { name: accept("trip") })[0]);
    await userEvent.click(screen.getAllByRole("button", { name: `${W}.dismissPhoto` })[1]);
    await waitFor(() => expect(photoJourneysApi.dismiss).toHaveBeenCalledWith("journey-2"));
    expect(screen.getAllByRole("button", { name: accept("trip") })[0]).toBeDisabled();

    releaseCreate?.();
    await waitFor(() =>
      expect(photoJourneysApi.accept).toHaveBeenCalledWith("journey-1", { createdTripId: "trip-9" })
    );
  });

  it("offers the scan when a library is connected, with the nightly opt-in beside it", async () => {
    await mount([], true);
    expect(await screen.findByRole("button", { name: `${K}.scan` })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: `${K}.nightlyLink` })).toHaveAttribute(
      "href",
      "/settings/services?section=externalServices"
    );
  });

  it("explains the missing connection and offers NO scan without one", async () => {
    await mount([], false);
    expect(await screen.findByText(`${K}.empty.noImmich.title`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: `${K}.empty.noImmich.link` })).toHaveAttribute(
      "href",
      "/settings/services?section=externalServices"
    );
    expect(screen.queryByRole("button", { name: `${K}.scan` })).not.toBeInTheDocument();
  });

  it("asks for the Immich status only once the photo filter is on screen", async () => {
    await mount([makeJourney()], true, "/pending-updates");
    expect(immichApi.getSettings).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /sources\.photos/ }));
    await waitFor(() => expect(immichApi.getSettings).toHaveBeenCalledTimes(1));
  });

  it("names a failed photo load instead of showing an empty inbox", async () => {
    vi.mocked(photoJourneysApi.list).mockRejectedValue(new Error("boom"));
    vi.mocked(immichApi.getSettings).mockResolvedValue({ hasAccess: true } as never);
    render(
      <MemoryRouter initialEntries={["/pending-updates?tab=photos"]}>
        <InboxWorkspace photosVisible />
      </MemoryRouter>
    );
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/loadFailed/)).toBeInTheDocument();
    expect(screen.queryByText(`${K}.empty.title`)).not.toBeInTheDocument();
  });
});
