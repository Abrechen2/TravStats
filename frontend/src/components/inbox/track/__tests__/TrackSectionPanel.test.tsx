import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackPoint } from "../../../../lib/api/travtrack";
import {
  installFakeIntersectionObserver,
  type FakeIntersectionObserverHandle,
} from "../../../../pages/Admin/__tests__/intersectionObserverStub";

/**
 * An inbox question's track section (owner, 2026-10-26) as the reader sees
 * it: read only once the card is on screen, facts that abstain rather than
 * show 0, every failure as itself, and a way onto the Track map that carries
 * the section's days.
 */

const views = vi.hoisted(() => ({ range: vi.fn() }));
vi.mock("../../../../lib/api/travtrackViews", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/api/travtrackViews")>()),
  travTrackViewsApi: views,
}));
const world = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../../../../lib/geo/worldCountries", () => ({ loadWorldCountries: world.load }));
vi.mock("../../../../hooks/useTodayZone", () => ({ useTodayZone: () => "UTC" }));
vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
    i18n: { language: "de" },
  }),
}));
const drawn = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock("../SectionMap", () => ({
  default: (props: Record<string, unknown>) => {
    drawn.props = props;
    return <div data-testid="section-map" />;
  },
}));

import TrackSectionPanel, { type TrackSectionPanelProps } from "../TrackSectionPanel";

const T = Date.parse("2026-10-20T08:00:00Z");
const MIN = 60_000;
const p = (minute: number, lat: number, lon: number): TrackPoint => [T + minute * MIN, lat, lon, 5];
const part = (segments: TrackPoint[][], next: string | null = null) => ({
  from: new Date(T).toISOString(),
  to: new Date(T + 60 * MIN).toISOString(),
  segments,
  pointIds: segments.map((s) => s.map((_, i) => `id${i}`)),
  pointCount: segments.flat().length,
  readCount: segments.flat().length,
  simplified: false,
  omittedSegments: 0,
  next,
  cursor: next ? `c-${next}` : null,
});

const base: TrackSectionPanelProps = {
  window: { fromMs: T, untilMs: T + 60 * MIN },
  zone: "UTC",
  why: { key: "track:inbox.why.journey" },
};

let io: FakeIntersectionObserverHandle;
beforeEach(() => {
  vi.clearAllMocks();
  drawn.props = null;
  io = installFakeIntersectionObserver();
});
afterEach(() => io.restore());

const show = (props: Partial<TrackSectionPanelProps> = {}) =>
  render(
    <MemoryRouter>
      <TrackSectionPanel {...base} {...props} />
    </MemoryRouter>
  );
const scrollIntoView = () => act(() => io.observers[0].trigger(true));
const fact = (label: string) =>
  screen.getByText(`track:inbox.fact.${label}`).nextElementSibling?.textContent;

describe("TrackSectionPanel", () => {
  it("reads nothing and draws no map until the card comes on screen", async () => {
    views.range.mockResolvedValue(part([[p(0, 50, 8), p(30, 50.1, 8)]]));
    show();
    expect(views.range).not.toHaveBeenCalled();
    expect(screen.queryByTestId("section-map")).toBeNull();
    scrollIntoView();
    expect(await screen.findByTestId("section-map")).toBeInTheDocument();
    expect(views.range).toHaveBeenCalledWith(
      { from: new Date(T).toISOString(), to: new Date(T + 60 * MIN).toISOString() },
      null
    );
  });

  it("unmounts the map when the card leaves the screen, keeps what was read, and redraws it", async () => {
    views.range.mockResolvedValue(part([[p(0, 50, 8), p(30, 50.1, 8)]]));
    show();
    scrollIntoView();
    await screen.findByTestId("section-map");
    act(() => io.observers[0].trigger(false));
    expect(screen.queryByTestId("section-map")).toBeNull();
    scrollIntoView();
    expect(await screen.findByTestId("section-map")).toBeInTheDocument();
    expect(views.range).toHaveBeenCalledTimes(1);
  });

  it("hands the map its stretches apart and does not count the distance across a cut", async () => {
    views.range.mockResolvedValue(
      part([
        [p(0, 50, 8), p(10, 50.1, 8)],
        [p(20, 52, 10), p(30, 52.1, 10)],
      ])
    );
    show();
    scrollIntoView();
    await screen.findByTestId("section-map");
    expect(drawn.props?.stretches).toEqual([
      [p(0, 50, 8), p(10, 50.1, 8)],
      [p(20, 52, 10), p(30, 52.1, 10)],
    ]);
    // ~11.1 km per stretch — the 200+ km step between them is not added.
    expect(fact("distance")).toBe(`track:inbox.value.km {"km":"22"}`);
    fireEvent.click(screen.getByRole("button", { name: "track:inbox.more" }));
    expect(screen.getByText(`track:inbox.detail.cuts {"count":1}`)).toBeInTheDocument();
  });

  it("abstains: a section of single fixes shows — for distance and speed, never 0", async () => {
    views.range.mockResolvedValue(part([[p(0, 50, 8)], [p(30, 51, 9)]]));
    show();
    scrollIntoView();
    await screen.findByTestId("section-map");
    expect(fact("distance")).toBe("track:inbox.value.none");
    expect(fact("speed")).toBe("track:inbox.value.none");
    expect(fact("points")).toBe("2");
  });

  it("TravTrack switched off is said as itself", async () => {
    views.range.mockRejectedValue({
      response: { status: 403, data: { code: "TRAVTRACK_DISABLED" } },
    });
    show();
    scrollIntoView();
    expect(await screen.findByRole("alert")).toHaveTextContent("track:errors.disabled");
    expect(screen.queryByTestId("section-map")).toBeNull();
  });

  it("a network failure is said as itself", async () => {
    views.range.mockRejectedValue(new Error("Network Error"));
    show();
    scrollIntoView();
    expect(await screen.findByRole("alert")).toHaveTextContent("track:errors.network");
  });

  it("a section with nothing left says so instead of drawing an empty map", async () => {
    views.range.mockResolvedValue(part([[p(-30, 50, 8)]]));
    show();
    scrollIntoView();
    expect(await screen.findByText("track:inbox.empty")).toBeInTheDocument();
    expect(screen.queryByTestId("section-map")).toBeNull();
  });

  it("follows the range's continuation up to its cap and then says the view is cut short", async () => {
    views.range
      .mockResolvedValueOnce(part([[p(0, 50, 8), p(5, 50.01, 8)]], "a"))
      .mockResolvedValueOnce(part([[p(10, 50.02, 8), p(15, 50.03, 8)]], "b"))
      .mockResolvedValueOnce(part([[p(20, 50.04, 8), p(25, 50.05, 8)]], "c"));
    show();
    scrollIntoView();
    await screen.findByTestId("section-map");
    expect(views.range).toHaveBeenCalledTimes(3);
    expect(views.range.mock.calls[1][1]).toBe("c-a");
    fireEvent.click(screen.getByRole("button", { name: "track:inbox.more" }));
    expect(screen.getByText("track:inbox.detail.truncated")).toBeInTheDocument();
  });

  it("D2: lays out by the card's width, and no fact is narrower than its label", () => {
    views.range.mockResolvedValue(part([]));
    show();
    const section = screen.getByTestId("track-section");
    // A container, not a viewport breakpoint: a half-width card at 1366 px stays one column.
    expect(section.className).toContain("@container");
    expect(section.innerHTML).not.toMatch(/\bmd:grid-cols/);
    const facts = screen.getByTestId("track-section-facts");
    expect(facts.className).toContain("minmax(9rem,1fr)");
    expect(facts.className).not.toMatch(/grid-cols-3/);
  });

  it("the Track-map link carries the section's days", () => {
    views.range.mockResolvedValue(part([]));
    show({
      window: {
        fromMs: Date.parse("2026-10-10T09:00:00Z"),
        untilMs: Date.parse("2026-10-12T10:30:00Z"),
      },
    });
    expect(screen.getByTestId("track-section-link")).toHaveAttribute(
      "href",
      "/track/2026-10-12?range=custom&from=2026-10-10"
    );
  });

  it("says why it asks, and a country question hands the map its outline", async () => {
    const austria = { type: "Feature", id: "040", properties: {}, geometry: null };
    world.load.mockResolvedValue({ type: "FeatureCollection", features: [austria] });
    views.range.mockResolvedValue(part([[p(0, 47, 12), p(30, 47.1, 12)]]));
    show({
      why: { key: "track:inbox.why.country", values: { country: "Österreich" } },
      countryCode: "at",
    });
    expect(
      screen.getByText(`track:inbox.why.country {"country":"Österreich"}`)
    ).toBeInTheDocument();
    scrollIntoView();
    await waitFor(() => expect(drawn.props?.country).toEqual(austria));
  });
});
