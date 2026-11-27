import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import TripPhotosCard from "../TripPhotosCard";
import type {
  LinkedPhoto,
  LinkedPhotoPage,
  TripPhotoProposals,
  TripPhotoSource,
} from "../../../../lib/api/tripPhotoSources";

const api = {
  photos: vi.fn(),
  proposals: vi.fn(),
  list: vi.fn(),
  addAlbum: vi.fn(),
  addPeriod: vi.fn(),
  dismiss: vi.fn(),
  remove: vi.fn(),
};
vi.mock("../../../../lib/api/tripPhotoSources", () => ({
  tripPhotoSourcesApi: new Proxy(
    {},
    {
      get:
        (_t, name: string) =>
        (...a: unknown[]) =>
          api[name as keyof typeof api](...a),
    }
  ),
}));
vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => (o ? `${key}${JSON.stringify(o)}` : key),
    i18n: { language: "de" },
    ready: true,
  }),
}));

const photo = (n: number, day: string): LinkedPhoto => ({
  key: `photoprism:${n}`,
  provider: "photoprism",
  sourceId: "p1",
  sourceKind: "period",
  url: `/api/v1/trips/t1/photo-sources/p1/assets/${n}/file?size=thumbnail`,
  previewUrl: `/api/v1/trips/t1/photo-sources/p1/assets/${n}/file?size=preview`,
  takenAt: `${day}T10:00:00.000Z`,
  day,
});

const page = (over: Partial<LinkedPhotoPage> = {}): LinkedPhotoPage => ({
  zone: "Europe/Berlin",
  totalAll: 30,
  total: 30,
  days: [
    { day: "2017-02-10", count: 20 },
    { day: "2017-02-11", count: 10 },
  ],
  photos: [1, 2, 3, 4].map((n) => photo(n, "2017-02-10")),
  nextCursor: "4",
  truncated: false,
  failures: [],
  ...over,
});
const noProposals: TripPhotoProposals = {
  connectionId: "photoprism",
  proposals: [],
  periodOffer: null,
  autoLinked: false,
  failure: null,
};
const period: TripPhotoSource = {
  id: "p1",
  kind: "period",
  provider: "photoprism",
  connectionId: "photoprism",
  name: null,
  from: "2017-02-10",
  until: "2017-02-12",
  pinned: false,
  auto: false,
  count: null,
  mode: null,
};

const renderCard = () =>
  render(
    <MemoryRouter>
      <TripPhotosCard tripId="t1" />
    </MemoryRouter>
  );

describe("TripPhotosCard", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.photos.mockResolvedValue(page());
    api.proposals.mockResolvedValue(noProposals);
    api.list.mockResolvedValue([period]);
  });

  it("shows four thumbnails plus '+N weitere', which opens the day-grouped gallery lazily", async () => {
    renderCard();
    const thumbs = await screen.findByTestId("trip-photos-thumbs");
    expect(within(thumbs).getAllByRole("img")).toHaveLength(4);
    expect(api.photos).toHaveBeenCalledWith("t1", { limit: 4 });
    const more = screen.getByRole("button", { name: "trips:photoLinks.showAll" });
    expect(more).toHaveTextContent('trips:photoLinks.more{"count":26}');

    api.photos.mockResolvedValueOnce(page({ photos: [photo(1, "2017-02-10")], nextCursor: null }));
    await userEvent.click(more);
    const days = await screen.findByTestId("linked-gallery-days");
    expect(within(days).getAllByRole("button")).toHaveLength(2);
    await waitFor(() =>
      expect(api.photos).toHaveBeenLastCalledWith("t1", {
        day: "2017-02-10",
        cursor: null,
        limit: 60,
      })
    );
    const grid = await screen.findByTestId("linked-gallery-grid");
    expect(within(grid).getByRole("img")).toHaveAttribute("loading", "lazy");
  });

  it("says which source failed instead of showing fewer photos in silence", async () => {
    api.photos.mockResolvedValue(
      page({
        failures: [
          { sourceId: "p1", sourceKind: "period", provider: "photoprism", kind: "unreachable" },
        ],
      })
    );
    renderCard();
    const alert = await screen.findByText(/trips:photoLinks\.sourceFailed/);
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert.textContent).toContain("immich:errors.photoprism.unreachable");
  });

  it("shows a load failure with a retry", async () => {
    api.photos.mockRejectedValueOnce(new Error("network"));
    renderCard();
    expect(await screen.findByText("trips:photoLinks.loadFailed")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "trips:photoLinks.retry" }));
    await waitFor(() => expect(api.photos).toHaveBeenCalledTimes(2));
  });

  it("links a proposed album or remembers 'nicht dieses'", async () => {
    api.proposals.mockResolvedValue({
      ...noProposals,
      proposals: [
        {
          key: "photoprism:f2017",
          connectionId: "photoprism",
          albumId: "f2017",
          name: "2017_Münster",
          count: 323,
          overlapDays: 3,
          reason: "folder",
        },
      ],
    });
    api.addAlbum.mockResolvedValue(null);
    api.dismiss.mockResolvedValue(undefined);
    renderCard();
    const row = await screen.findByTestId("photo-proposal");
    expect(row.textContent).toContain('trips:photoLinks.proposal{"name":"2017_Münster"}');
    await userEvent.click(within(row).getByRole("button", { name: "trips:photoLinks.link" }));
    expect(api.addAlbum).toHaveBeenCalledWith("t1", "photoprism", "f2017");
    await userEvent.click(within(row).getByRole("button", { name: "trips:photoLinks.notThis" }));
    expect(api.dismiss).toHaveBeenCalledWith("t1", "photoprism:f2017");
  });

  it("offers the period of a business trip with one click and says a refusal", async () => {
    api.list.mockResolvedValue([]);
    api.photos.mockResolvedValue(
      page({ totalAll: 0, total: 0, days: [], photos: [], nextCursor: null })
    );
    api.proposals.mockResolvedValue({
      ...noProposals,
      periodOffer: { connectionId: "photoprism", from: "2017-02-10", until: "2017-02-12" },
    });
    api.addPeriod.mockRejectedValue({ response: { data: { error: "noDates" } } });
    renderCard();
    const offer = await screen.findByTestId("period-offer");
    await userEvent.click(
      within(offer).getByRole("button", { name: "trips:photoLinks.linkPeriod" })
    );
    expect(api.addPeriod).toHaveBeenCalledWith("t1");
    expect(
      await screen.findByText(/trips:photoLinks\.actionFailed.*trips:photoLinks\.refusal\.noDates/)
    ).toHaveAttribute("role", "alert");
  });

  it("removes a source, but sends an imported album to the gallery", async () => {
    api.list.mockResolvedValue([
      period,
      { ...period, id: "a1", kind: "album", name: "Alt", mode: "import" },
    ]);
    api.remove.mockResolvedValue(undefined);
    renderCard();
    const list = await screen.findByTestId("photo-sources");
    const buttons = within(list).getAllByRole("button", { name: "trips:photoLinks.remove" });
    expect(buttons).toHaveLength(1);
    expect(within(list).getByText("trips:photoLinks.removeImported")).toBeInTheDocument();
    await userEvent.click(buttons[0]);
    expect(api.remove).toHaveBeenCalledWith("t1", "p1");
  });

  it("renders nothing for an account without any photo source", async () => {
    api.list.mockResolvedValue([]);
    api.photos.mockResolvedValue(
      page({ totalAll: 0, total: 0, days: [], photos: [], nextCursor: null })
    );
    api.proposals.mockResolvedValue({ ...noProposals, connectionId: null });
    const { container } = renderCard();
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
