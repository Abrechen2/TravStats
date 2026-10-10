import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import VisitSuggestionsReview from "../VisitSuggestionsReview";
import {
  photoJourneysApi,
  type PhotoJourneyBatchResponse,
} from "../../../../lib/api/photoJourneys";
import { listPlaces } from "../../../../lib/api/places";
import type { PhotoJourney } from "../../../../types/photoJourney";

/**
 * forgejo#211, O5 — reviewing visit suggestions together. What each case
 * pins, and why it would fail without the review:
 *
 * - a suggestion shows place, time span and the reasoning together;
 * - several are answered in ONE request, and its per-item outcome reaches the
 *   reader item by item — a failed one stays selected and names its reason;
 * - a request that fails as a whole is NOT reported as "nothing saved" (the
 *   server may have answered some): the list reloads and the reader is told;
 * - corrections travel as corrections, and only when something changed;
 * - a suggestion a logged visit already explains is flagged, not hidden.
 */

vi.mock("../../../../lib/api/photoJourneys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/api/photoJourneys")>();
  return { ...actual, photoJourneysApi: { review: vi.fn() } };
});
vi.mock("../../../../lib/api/places", () => ({ listPlaces: vi.fn() }));

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
  nearestVisit: {
    placeId: "yongsan",
    placeName: "Yongsan Station",
    distanceKm: 1.3,
    sameDay: false,
    withinReach: false,
  },
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

function renderReview(rows: PhotoJourney[]) {
  const onAnswered = vi.fn().mockResolvedValue(undefined);
  render(<VisitSuggestionsReview journeys={rows} onAnswered={onAnswered} />);
  return { onAnswered };
}
const card = (name: string) => screen.getByRole("article", { name });
const checkbox = (name: string) => within(card(name)).getByRole("checkbox");

describe("VisitSuggestionsReview (forgejo#211, O5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listPlaces).mockResolvedValue([]);
  });

  it("shows place, time span and the reasoning together, with the preview strip", () => {
    renderReview([MEMORIAL]);
    const memorial = card("War Memorial of Korea");
    expect(within(memorial).getByText(/16:58/)).toBeInTheDocument();
    const reasons = within(memorial).getByRole("list", { name: `${K}.review.reasonLabel` });
    expect(within(reasons).getByText(`${K}.facts.photos`)).toBeInTheDocument();
    expect(within(reasons).getByText(`${K}.review.reason.dwell`)).toBeInTheDocument();
    expect(within(reasons).getByText(`${K}.facts.trip`)).toBeInTheDocument();
    expect(within(reasons).getByText(`${K}.review.reason.nearest`)).toBeInTheDocument();
    const thumbs = within(memorial).getAllByRole("img");
    expect(thumbs.map((img) => img.getAttribute("src"))).toEqual([
      expect.stringContaining("/photo-journeys/memorial/preview/0/file"),
      expect.stringContaining("/photo-journeys/memorial/preview/1/file"),
      expect.stringContaining("/photo-journeys/memorial/preview/2/file"),
    ]);
  });

  it("promises what accepting will make: a new place, the own place nearby, or the chosen one", async () => {
    vi.mocked(listPlaces).mockResolvedValue([
      { id: "near", name: "Palace grounds", lat: 37.58, lon: 126.977, city: "Seoul" },
    ] as never);
    renderReview([visit(), { ...MEMORIAL, placeId: "own-memorial" }]);
    const palace = card("Gyeongbokgung");
    expect(within(palace).getByText(`${K}.review.creates.newPlace`)).toBeInTheDocument();
    expect(
      within(card("War Memorial of Korea")).getByText(`${K}.review.creates.ownPlace`)
    ).toBeInTheDocument();

    await userEvent.click(within(palace).getByRole("button", { name: `${K}.review.correct` }));
    await userEvent.click(await within(palace).findByRole("button", { name: /Palace grounds/ }));
    expect(within(palace).getByText(`${K}.review.creates.chosenPlace`)).toBeInTheDocument();
  });

  it("flags a suggestion a visit logged since the scan already explains", () => {
    renderReview([
      visit({
        nearestVisit: {
          placeId: "gate",
          placeName: "Gwanghwamun",
          distanceKm: 0.05,
          sameDay: true,
          withinReach: true,
        },
      }),
    ]);
    expect(within(card("Gyeongbokgung")).getByRole("note")).toHaveTextContent(
      `${K}.review.alreadyVisited`
    );
  });

  it("accepts the selected suggestions in ONE request and reloads", async () => {
    respond([accepted("palace"), accepted("memorial")]);
    const { onAnswered } = renderReview([visit(), MEMORIAL]);

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
    await waitFor(() => expect(onAnswered).toHaveBeenCalled());
    expect(addToast).toHaveBeenCalledWith("success", `${K}.review.summary`);
  });

  it("names each item that failed and why, and keeps it selected for a retry", async () => {
    respond([
      accepted("palace"),
      { id: "memorial", action: "accept", outcome: "failed", code: "VISIT_PLACE_NOT_FOUND" },
    ]);
    renderReview([visit(), MEMORIAL]);

    await userEvent.click(screen.getByRole("checkbox", { name: `${K}.review.selectAll` }));
    await userEvent.click(screen.getByRole("button", { name: `${K}.review.acceptSelected` }));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("warning", `${K}.review.summary`));
    const alerts = screen.getAllByRole("alert");
    expect(alerts[0]).toHaveTextContent("War Memorial of Korea");
    expect(alerts[0]).toHaveTextContent(`${K}.review.failure.VISIT_PLACE_NOT_FOUND`);
    expect(within(card("War Memorial of Korea")).getByRole("alert")).toHaveTextContent(
      `${K}.review.failure.VISIT_PLACE_NOT_FOUND`
    );
    expect(checkbox("War Memorial of Korea")).toBeChecked();
    expect(checkbox("Gyeongbokgung")).not.toBeChecked();
  });

  it("says the outcome is unknown when the request itself fails, and reloads the truth", async () => {
    vi.mocked(photoJourneysApi.review).mockRejectedValue(new Error("Network Error"));
    const { onAnswered } = renderReview([visit()]);

    await userEvent.click(screen.getByRole("button", { name: `${K}.actions.dismiss` }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(`${K}.review.requestFailed`)
    );
    expect(onAnswered).toHaveBeenCalled();
  });

  it("rejects the selected suggestions together", async () => {
    respond([
      { id: "palace", action: "dismiss", outcome: "dismissed" },
      { id: "memorial", action: "dismiss", outcome: "dismissed" },
    ]);
    renderReview([visit(), MEMORIAL]);
    await userEvent.click(screen.getByRole("checkbox", { name: `${K}.review.selectAll` }));
    await userEvent.click(screen.getByRole("button", { name: `${K}.review.dismissSelected` }));
    await waitFor(() =>
      expect(photoJourneysApi.review).toHaveBeenCalledWith([
        { id: "palace", action: "dismiss" },
        { id: "memorial", action: "dismiss" },
      ])
    );
  });

  it("sends the corrected name and time — and only what changed", async () => {
    respond([accepted("palace")]);
    renderReview([visit()]);
    const palace = card("Gyeongbokgung");

    await userEvent.click(within(palace).getByRole("button", { name: `${K}.review.correct` }));
    const name = within(palace).getByLabelText(`${K}.review.correction.name`);
    await userEvent.clear(name);
    await userEvent.type(name, "Gyeongbok Palace");
    const time = within(palace).getByLabelText(`${K}.review.correction.time`);
    expect(time).toHaveValue("2026-10-05T11:19");
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

  it("records the visit on an own place picked from all of the reader's places", async () => {
    vi.mocked(listPlaces).mockResolvedValue([
      { id: "far", name: "Busan Tower", lat: 35.1, lon: 129.03, city: "Busan" },
      { id: "near", name: "Palace grounds", lat: 37.58, lon: 126.977, city: "Seoul" },
    ] as never);
    respond([accepted("palace")]);
    renderReview([visit()]);
    const palace = card("Gyeongbokgung");

    await userEvent.click(within(palace).getByRole("button", { name: `${K}.review.correct` }));
    await userEvent.click(await within(palace).findByRole("button", { name: /Palace grounds/ }));
    expect(within(palace).queryByLabelText(`${K}.review.correction.name`)).toBeNull();
    await userEvent.click(
      within(palace).getByRole("button", { name: `${K}.review.acceptCorrected` })
    );
    await waitFor(() =>
      expect(photoJourneysApi.review).toHaveBeenCalledWith([
        { id: "palace", action: "accept", placeId: "near" },
      ])
    );
  });

  it("refuses to send a nameless suggestion and says what is missing", async () => {
    renderReview([visit({ suggestedName: null, city: null, countryName: null })]);
    await userEvent.click(screen.getByRole("checkbox", { name: `${K}.review.selectAll` }));
    expect(screen.getByRole("button", { name: `${K}.review.acceptSelected` })).toBeDisabled();
    expect(screen.getByText(`${K}.review.unnamedSelected`)).toBeInTheDocument();
    expect(photoJourneysApi.review).not.toHaveBeenCalled();
  });

  it("is operable by keyboard: Space selects, the toolbar answers", async () => {
    respond([{ id: "palace", action: "dismiss", outcome: "dismissed" }]);
    renderReview([visit()]);
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
