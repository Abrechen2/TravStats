import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import InboxWorkspace from "../InboxWorkspace";
import { dataQualityFlagsApi } from "../../../../lib/api/dataQualityFlags";
import { tripSuggestionsApi } from "../../../../lib/api/tripSuggestions";
import { pendingUpdatesApi } from "../../../../lib/api/pendingUpdates";
import {
  photoJourneysApi,
  type PhotoJourneyBatchResponse,
} from "../../../../lib/api/photoJourneys";
import { tripsApi } from "../../../../lib/api/trips";
import { immichApi } from "../../../../lib/api/immich";
import { listPlaces } from "../../../../lib/api/places";
import type { PhotoJourney } from "../../../../types/photoJourney";

/**
 * forgejo#211, O5 — reviewing visit suggestions together, now inside the one
 * inbox. The old photo tab had a batch review the workspace lacked; the
 * workspace had per-card answers the batch review drew differently. One card
 * (`VisitSuggestionCard`) and one batch bar remain, sharing one selection:
 *
 * - a suggestion shows place, time span and the reasoning together;
 * - several are answered in ONE request, and its per-item outcome reaches the
 *   reader item by item — a failed one stays selected and names its reason;
 * - a request that fails as a whole is NOT reported as "nothing saved" (the
 *   server may have answered some): the inbox reloads and the reader is told;
 * - corrections travel as corrections, and only when something changed.
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
vi.mock("../../../../lib/api/photoJourneys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/api/photoJourneys")>();
  return {
    ...actual,
    photoJourneysApi: { list: vi.fn(), review: vi.fn(), accept: vi.fn(), dismiss: vi.fn() },
  };
});
vi.mock("../../../../lib/api/trips", () => ({ tripsApi: { getAll: vi.fn() } }));
vi.mock("../../../../lib/api/dawarichStays", () => ({
  dawarichStaysApi: {
    list: vi.fn(async () => []),
    listPage: vi.fn(async () => ({ rows: [], truncated: false })),
    choices: vi.fn(),
  },
}));
vi.mock("../../../../lib/api/immich", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/api/immich")>();
  return { ...actual, immichApi: { getSettings: vi.fn() } };
});
vi.mock("../../../../lib/api/places", () => ({ listPlaces: vi.fn() }));
vi.mock("../../../GlobeLoader", () => ({ GlobeLoader: () => null }));

const addToast = vi.fn();
const toastState = { addToast: (...args: unknown[]) => addToast(...args) };
vi.mock("../../../../store/toastStore", () => ({
  useToastStore: (selector: (s: typeof toastState) => unknown) => selector(toastState),
}));

const K = "dataQuality:inbox.photoJourneys";

function visit(over: Partial<PhotoJourney> = {}): PhotoJourney {
  return {
    id: "palace",
    status: "pending",
    kind: "visit",
    startDate: "2026-10-05T02:19:00.000Z",
    endDate: "2026-10-05T02:49:00.000Z",
    startLocal: "2026-10-05T11:19:00",
    endLocal: "2026-10-05T11:49:00",
    startDay: "2026-10-05",
    endDay: "2026-10-05",
    tripId: "trip-korea",
    tripName: "Korea",
    suggestedName: "Gyeongbokgung",
    suggestedLocalName: null,
    suggestedRef: "osm:way/2",
    photoCount: 20,
    locatedCount: 20,
    lat: 37.5796,
    lon: 126.977,
    countryCode: "KR",
    countryName: "South Korea",
    city: "Seoul",
    previewAssetIds: ["a1", "a2", "a3"],
    placeId: null,
    distanceKm: null,
    nights: 0,
    airportIata: null,
    spreadKm: null,
    nearestVisit: {
      placeId: "gate",
      placeName: "Hyupsaengmun Gate",
      distanceKm: 0.35,
      sameDay: true,
      withinReach: false,
    },
    createdTripId: null,
    createdPlaceVisitId: null,
    createdLodgingStayId: null,
    resolvedAt: null,
    createdAt: "2026-10-07T03:00:00.000Z",
    ...over,
  };
}

const MEMORIAL = visit({
  id: "memorial",
  suggestedName: "War Memorial of Korea",
  photoCount: 41,
  locatedCount: 41,
  startLocal: "2026-10-05T16:58:00",
  endLocal: "2026-10-05T17:21:00",
});

function respond(results: PhotoJourneyBatchResponse["results"]): void {
  const count = (o: string) => results.filter((r) => r.outcome === o).length;
  vi.mocked(photoJourneysApi.review).mockResolvedValue({
    results,
    summary: {
      accepted: count("accepted"),
      dismissed: count("dismissed"),
      failed: count("failed"),
    },
  });
}
const accepted = (id: string) =>
  ({
    id,
    action: "accept",
    outcome: "accepted",
    created: { placeId: "p", placeVisitId: "v", placeCreated: true, visitCreated: true },
    photos: null,
  }) as const;

async function mount(rows: PhotoJourney[]) {
  vi.mocked(photoJourneysApi.list).mockResolvedValue(rows);
  render(
    <MemoryRouter initialEntries={["/pending-updates?tab=photos"]}>
      <InboxWorkspace photosVisible />
    </MemoryRouter>
  );
  await screen.findByRole("checkbox", { name: `${K}.review.selectAll` });
}
const card = (name: string) => screen.getByRole("article", { name });
const checkbox = (name: string) => within(card(name)).getByRole("checkbox");

describe("visit suggestions in the inbox (forgejo#211, O5)", () => {
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
    vi.mocked(immichApi.getSettings).mockResolvedValue({ hasAccess: true } as never);
    vi.mocked(listPlaces).mockResolvedValue([]);
  });

  it("shows place, time span and the reasoning together, with the preview strip", async () => {
    await mount([MEMORIAL]);
    const memorial = card("War Memorial of Korea");
    expect(within(memorial).getByText(/16:58/)).toBeInTheDocument();
    const reasons = within(memorial).getByRole("list", { name: `${K}.review.reasonLabel` });
    expect(within(reasons).getByText(`${K}.review.reason.dwell`)).toBeInTheDocument();
    expect(within(reasons).getByText(`${K}.review.reason.nearest`)).toBeInTheDocument();
    expect(within(memorial).getAllByRole("img")[0].getAttribute("src")).toContain(
      "/photo-journeys/memorial/preview/0/file"
    );
  });

  it("accepts the selected suggestions in ONE request and reloads the inbox", async () => {
    respond([accepted("palace"), accepted("memorial")]);
    await mount([visit(), MEMORIAL]);
    const lists = vi.mocked(photoJourneysApi.list).mock.calls.length;

    await userEvent.click(checkbox("Gyeongbokgung"));
    await userEvent.click(checkbox("War Memorial of Korea"));
    await userEvent.click(screen.getByRole("button", { name: `${K}.review.acceptSelected` }));

    await waitFor(() =>
      expect(photoJourneysApi.review).toHaveBeenCalledWith([
        { id: "palace", action: "accept" },
        { id: "memorial", action: "accept" },
      ])
    );
    expect(photoJourneysApi.review).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(vi.mocked(photoJourneysApi.list).mock.calls.length).toBeGreaterThan(lists)
    );
    expect(addToast).toHaveBeenCalledWith("success", `${K}.review.summary`);
  });

  it("names each item that failed and why, and keeps it selected for a retry", async () => {
    respond([
      accepted("palace"),
      { id: "memorial", action: "accept", outcome: "failed", code: "VISIT_PLACE_NOT_FOUND" },
    ]);
    await mount([visit(), MEMORIAL]);

    await userEvent.click(screen.getByRole("checkbox", { name: `${K}.review.selectAll` }));
    await userEvent.click(screen.getByRole("button", { name: `${K}.review.acceptSelected` }));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("warning", `${K}.review.summary`));
    expect(within(card("War Memorial of Korea")).getByRole("alert")).toHaveTextContent(
      `${K}.review.failure.VISIT_PLACE_NOT_FOUND`
    );
    expect(checkbox("War Memorial of Korea")).toBeChecked();
    expect(checkbox("Gyeongbokgung")).not.toBeChecked();
  });

  it("says the outcome is unknown when the request itself fails, and reloads the truth", async () => {
    vi.mocked(photoJourneysApi.review).mockRejectedValue(new Error("Network Error"));
    await mount([visit()]);

    await userEvent.click(
      within(card("Gyeongbokgung")).getByRole("button", { name: `${K}.actions.dismiss` })
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(`${K}.review.requestFailed`)
    );
    await waitFor(() =>
      expect(vi.mocked(photoJourneysApi.list).mock.calls.length).toBeGreaterThan(1)
    );
  });

  it("sends the corrected name and time — and only what changed", async () => {
    respond([accepted("palace")]);
    await mount([visit()]);
    const palace = card("Gyeongbokgung");

    await userEvent.click(within(palace).getByRole("button", { name: `${K}.review.correct` }));
    const name = within(palace).getByLabelText(`${K}.review.correction.name`);
    await userEvent.clear(name);
    await userEvent.type(name, "Gyeongbok Palace");
    const time = within(palace).getByLabelText(`${K}.review.correction.time`);
    await userEvent.clear(time);
    await userEvent.type(time, "2026-10-05T11:00");

    await userEvent.click(
      within(palace).getByRole("button", { name: `${K}.review.acceptCorrected` })
    );
    await waitFor(() =>
      expect(photoJourneysApi.review).toHaveBeenCalledWith([
        {
          id: "palace",
          action: "accept",
          name: "Gyeongbok Palace",
          visitedAt: { local: "2026-10-05T11:00" },
        },
      ])
    );
  });

  it("refuses to send a nameless suggestion and says what is missing", async () => {
    await mount([visit({ suggestedName: null, city: null, countryName: null }), MEMORIAL]);
    await userEvent.click(screen.getByRole("checkbox", { name: `${K}.review.selectAll` }));
    expect(screen.getByRole("button", { name: `${K}.review.acceptSelected` })).toBeDisabled();
    expect(screen.getByText(`${K}.review.unnamedSelected`)).toBeInTheDocument();
    expect(photoJourneysApi.review).not.toHaveBeenCalled();
  });

  it("is operable by keyboard: Space selects, the batch bar answers", async () => {
    respond([{ id: "palace", action: "dismiss", outcome: "dismissed" }]);
    await mount([visit(), MEMORIAL]);
    checkbox("Gyeongbokgung").focus();
    await userEvent.keyboard(" ");
    expect(checkbox("Gyeongbokgung")).toBeChecked();
    screen.getByRole("button", { name: `${K}.review.dismissSelected` }).focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() =>
      expect(photoJourneysApi.review).toHaveBeenCalledWith([{ id: "palace", action: "dismiss" }])
    );
  });
});
