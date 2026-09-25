import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import PhotoJourneysTab from "../PhotoJourneysTab";
import { photoJourneysApi } from "../../../lib/api/photoJourneys";
import { immichApi } from "../../../lib/api/immich";
import { tripsApi } from "../../../lib/api/trips";
import { createVisit } from "../../../lib/api/places";
import type { PhotoJourney } from "../../../types/photoJourney";

/**
 * Nothing on the web read `/api/v1/photo-journeys` before this tab
 * (forgejo#94, point 1), so every one of these cases fails without it. Three
 * are about wiring that can be wrong SILENTLY:
 *
 * - **The strip must be addressed by index.** An `<img src>` carrying an asset
 *   id would 404 on every thumbnail and look like a broken library rather than
 *   a client bug — and if the proxy ever accepted an id, it would be a reader
 *   for the whole Immich. The row is the grant; the test reads the URLs.
 * - **Accept must create before it answers, and the right thing per reading.**
 *   A PATCH without the created id leaves a question answered and nothing
 *   recorded, which cannot be asked again.
 * - **The scan must not be offered where it cannot run.** `hasAccess` is the
 *   same resolver the scan calls, and it is `false` for an account with no
 *   Immich AND for the shared demo.
 */

// `importOriginal` keeps `photoJourneyPreviewUrl` real: it is the thing under
// test in the strip case, and a stubbed URL builder would assert the stub.
vi.mock("../../../lib/api/photoJourneys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/photoJourneys")>();
  return {
    ...actual,
    photoJourneysApi: {
      list: vi.fn(),
      scan: vi.fn(),
      accept: vi.fn(),
      dismiss: vi.fn(),
    },
  };
});
vi.mock("../../../lib/api/immich", () => ({
  immichApi: { getSettings: vi.fn() },
}));
vi.mock("../../../lib/api/trips", () => ({
  tripsApi: { create: vi.fn() },
}));
vi.mock("../../../lib/api/places", () => ({
  createVisit: vi.fn(),
}));

const addToast = vi.fn();
// One frozen state object selected out of, the way zustand behaves: a fresh
// object per call would hand the component a new `addToast` identity every
// render, re-create its `load` callback and refetch forever.
const toastState = { addToast: (...args: unknown[]) => addToast(...args) };
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: typeof toastState) => unknown) => selector(toastState),
}));

function makeJourney(over: Partial<PhotoJourney> = {}): PhotoJourney {
  return {
    id: "journey-1",
    status: "pending",
    kind: "trip",
    startDate: "2026-04-02T08:00:00.000Z",
    endDate: "2026-04-06T19:00:00.000Z",
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

async function renderTab(rows: PhotoJourney[], hasAccess = true, active = true): Promise<void> {
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
    <MemoryRouter>
      <PhotoJourneysTab active={active} />
    </MemoryRouter>
  );
  await waitFor(() => expect(photoJourneysApi.list).toHaveBeenCalledWith("pending"));
}

const ACCEPT = "dataQuality:inbox.photoJourneys.actions.accept";
const DISMISS = "dataQuality:inbox.photoJourneys.actions.dismiss";

describe("PhotoJourneysTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("draws the preview strip from the row id and the INDEX, never from an asset id", async () => {
    const journey = makeJourney();
    await renderTab([journey]);

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

  it("reports the number of pending rows for the tab label", async () => {
    const onPendingCount = vi.fn();
    vi.mocked(photoJourneysApi.list).mockResolvedValue([
      makeJourney(),
      makeJourney({ id: "journey-2" }),
    ]);
    vi.mocked(immichApi.getSettings).mockRejectedValue(new Error("offline"));
    render(
      <MemoryRouter>
        <PhotoJourneysTab onPendingCount={onPendingCount} />
      </MemoryRouter>
    );

    await waitFor(() => expect(onPendingCount).toHaveBeenCalledWith(2));
  });

  it("accepting a trip finding creates the trip FIRST, then links it, and drops the row", async () => {
    vi.mocked(tripsApi.create).mockResolvedValue({ id: "trip-9" } as never);
    await renderTab([makeJourney()]);

    vi.mocked(photoJourneysApi.list).mockResolvedValue([]);
    await userEvent.click(
      screen.getByRole("button", { name: "dataQuality:inbox.photoJourneys.actions.accept" })
    );

    await waitFor(() =>
      expect(tripsApi.create).toHaveBeenCalledWith({
        name: "Lissabon, Portugal",
        startDate: "2026-04-02T08:00:00.000Z",
        endDate: "2026-04-06T19:00:00.000Z",
      })
    );
    expect(photoJourneysApi.accept).toHaveBeenCalledWith("journey-1", { createdTripId: "trip-9" });
    expect(createVisit).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryAllByRole("img")).toHaveLength(0));
  });

  it("accepting a place finding records a visit at that place, not a trip", async () => {
    vi.mocked(createVisit).mockResolvedValue({ id: "visit-3" } as never);
    await renderTab([makeJourney({ kind: "place", placeId: "place-7", airportIata: null })]);

    vi.mocked(photoJourneysApi.list).mockResolvedValue([]);
    await userEvent.click(
      screen.getByRole("button", { name: "dataQuality:inbox.photoJourneys.actions.accept" })
    );

    await waitFor(() =>
      expect(createVisit).toHaveBeenCalledWith("place-7", { visitedAt: "2026-04-02T08:00:00.000Z" })
    );
    expect(photoJourneysApi.accept).toHaveBeenCalledWith("journey-1", {
      createdPlaceVisitId: "visit-3",
    });
    expect(tripsApi.create).not.toHaveBeenCalled();
  });

  it("says how many photographs came along with an accepted place finding", async () => {
    vi.mocked(createVisit).mockResolvedValue({ id: "visit-3" } as never);
    vi.mocked(photoJourneysApi.accept).mockResolvedValue({
      kind: "linked",
      linked: 3,
      skipped: 1,
    });
    await renderTab([makeJourney({ kind: "place", placeId: "place-7", airportIata: null })]);

    vi.mocked(photoJourneysApi.list).mockResolvedValue([]);
    await userEvent.click(screen.getByRole("button", { name: ACCEPT }));

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(
        "success",
        "dataQuality:inbox.photoJourneys.messages.photosLinked"
      )
    );
  });

  it("warns when the photo library was down while the place finding was accepted", async () => {
    vi.mocked(createVisit).mockResolvedValue({ id: "visit-3" } as never);
    vi.mocked(photoJourneysApi.accept).mockResolvedValue({ kind: "failed", reason: "unreachable" });
    await renderTab([makeJourney({ kind: "place", placeId: "place-7", airportIata: null })]);

    vi.mocked(photoJourneysApi.list).mockResolvedValue([]);
    await userEvent.click(screen.getByRole("button", { name: ACCEPT }));

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(
        "warning",
        "dataQuality:inbox.photoJourneys.messages.photosNotLinked"
      )
    );
  });

  it("accepting a stay finding creates nothing — a stay needs a lodging the row does not name", async () => {
    await renderTab([makeJourney({ kind: "stay", placeId: "place-7" })]);

    vi.mocked(photoJourneysApi.list).mockResolvedValue([]);
    await userEvent.click(
      screen.getByRole("button", { name: "dataQuality:inbox.photoJourneys.actions.accept" })
    );

    await waitFor(() => expect(photoJourneysApi.accept).toHaveBeenCalledWith("journey-1"));
    expect(tripsApi.create).not.toHaveBeenCalled();
    expect(createVisit).not.toHaveBeenCalled();
  });

  it("dismissing answers the one endpoint and drops the row", async () => {
    await renderTab([makeJourney()]);

    vi.mocked(photoJourneysApi.list).mockResolvedValue([]);
    await userEvent.click(
      screen.getByRole("button", { name: "dataQuality:inbox.photoJourneys.actions.dismiss" })
    );

    await waitFor(() => expect(photoJourneysApi.dismiss).toHaveBeenCalledWith("journey-1"));
    expect(photoJourneysApi.accept).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryAllByRole("img")).toHaveLength(0));
  });

  it("offers the scan when a library is connected", async () => {
    await renderTab([], true);

    expect(
      await screen.findByRole("button", { name: "dataQuality:inbox.photoJourneys.scan" })
    ).toBeInTheDocument();
  });

  it("explains the missing connection and offers NO scan without one", async () => {
    await renderTab([], false);

    expect(
      await screen.findByText("dataQuality:inbox.photoJourneys.empty.noImmich.title")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "dataQuality:inbox.photoJourneys.empty.noImmich.link" })
    ).toHaveAttribute("href", "/settings/services?section=externalServices");
    expect(
      screen.queryByRole("button", { name: "dataQuality:inbox.photoJourneys.scan" })
    ).not.toBeInTheDocument();
  });

  it("reports a load failure instead of showing an empty inbox silently", async () => {
    vi.mocked(photoJourneysApi.list).mockRejectedValue(new Error("boom"));
    vi.mocked(immichApi.getSettings).mockRejectedValue(new Error("boom"));
    render(
      <MemoryRouter>
        <PhotoJourneysTab />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(
        "error",
        "dataQuality:inbox.photoJourneys.errors.loadFailed"
      )
    );
  });
  it("keeps what it created when only the PATCH fails, and a retry creates nothing more", async () => {
    // The dangerous half-state: POST /trips succeeded, PATCH did not. The row is
    // still pending with a trip already in the journal, so a second click must
    // link that trip rather than book a second holiday.
    vi.mocked(tripsApi.create).mockResolvedValue({ id: "trip-9" } as never);
    vi.mocked(photoJourneysApi.accept).mockRejectedValue(new Error("gateway"));
    await renderTab([makeJourney()]);

    await userEvent.click(screen.getByRole("button", { name: ACCEPT }));

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(
        "error",
        // Names what EXISTS now, not "nothing was created".
        "dataQuality:inbox.photoJourneys.errors.acceptLinkFailed.trip"
      )
    );

    vi.mocked(photoJourneysApi.accept).mockResolvedValue(null);
    await userEvent.click(screen.getByRole("button", { name: ACCEPT }));

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(
        "success",
        "dataQuality:inbox.photoJourneys.messages.accepted.trip"
      )
    );
    expect(tripsApi.create).toHaveBeenCalledTimes(1);
    expect(photoJourneysApi.accept).toHaveBeenCalledTimes(2);
    expect(photoJourneysApi.accept).toHaveBeenLastCalledWith("journey-1", {
      createdTripId: "trip-9",
    });
  });

  it("asks for the Immich status only once the tab is the one on screen", async () => {
    await renderTab([makeJourney()], true, false);

    // The list runs either way — the tab label's count is what the page mounts
    // this section for. The connection status is read by the panel alone.
    expect(photoJourneysApi.list).toHaveBeenCalledTimes(1);
    expect(immichApi.getSettings).not.toHaveBeenCalled();
  });

  it("keeps each row's buttons disabled on its OWN answer, not on a sibling's", async () => {
    // One `busyId` for the whole tab meant answering B re-enabled A while A was
    // still in flight — and A's button is the one that must not fire twice.
    let releaseCreate: (() => void) | undefined;
    vi.mocked(tripsApi.create).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseCreate = () => resolve({ id: "trip-9" } as never);
        })
    );
    vi.mocked(photoJourneysApi.dismiss).mockResolvedValue(undefined);
    await renderTab([makeJourney(), makeJourney({ id: "journey-2" })]);

    const acceptA = screen.getAllByRole("button", { name: ACCEPT })[0];
    await userEvent.click(acceptA);
    await userEvent.click(screen.getAllByRole("button", { name: DISMISS })[1]);

    await waitFor(() => expect(photoJourneysApi.dismiss).toHaveBeenCalledWith("journey-2"));
    // B is answered and A is not, so A stays shut.
    expect(screen.getAllByRole("button", { name: ACCEPT })[0]).toBeDisabled();

    releaseCreate?.();
    await waitFor(() =>
      expect(photoJourneysApi.accept).toHaveBeenCalledWith("journey-1", {
        createdTripId: "trip-9",
      })
    );
    await waitFor(() => expect(screen.getAllByRole("button", { name: ACCEPT })[0]).toBeEnabled());
  });
});
