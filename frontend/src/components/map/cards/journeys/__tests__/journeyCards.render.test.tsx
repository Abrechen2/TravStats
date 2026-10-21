import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import deMap from "../../../../../i18n/resources/de/map.json";
import enMap from "../../../../../i18n/resources/en/map.json";
import deRail from "../../../../../i18n/resources/de/rail.json";
import enRail from "../../../../../i18n/resources/en/rail.json";
import deTrips from "../../../../../i18n/resources/de/trips.json";
import enTrips from "../../../../../i18n/resources/en/trips.json";
import deCommon from "../../../../../i18n/resources/de/common.json";
import enCommon from "../../../../../i18n/resources/en/common.json";
import { PinnedCard } from "../../PinnedCard";
import type { MapPinned } from "../../pinnedTypes";
import {
  journeyFromFerry,
  journeyFromRail,
  journeyFromRental,
  journeyFromTripFlight,
} from "../journeyNormalize";
import { tourCardDatum } from "../tourLayerCards";
import type { TourSummary } from "../../../../../lib/api/tourIndex";

/**
 * The journey cards in both languages, read from the REAL bundles — a key
 * missing from one side would render as the key itself, which is exactly what
 * a mocked `t` hides. Also pinned: the domain identity (badge, flags, colour
 * stripe) and the operator mark's fallback to a monogram.
 */

const BUNDLES = {
  de: { map: deMap, rail: deRail, trips: deTrips, common: deCommon },
  en: { map: enMap, rail: enRail, trips: enTrips, common: enCommon },
} as const;
const lang = vi.hoisted(() => ({ current: "de" as "de" | "en" }));
const navigate = vi.hoisted(() => vi.fn());

function lookup(key: string, opts?: Record<string, unknown>): string {
  const [ns, path] = key.includes(":") ? key.split(":") : ["map", key];
  const bundle = (BUNDLES[lang.current] as Record<string, unknown>)[ns];
  const walk = (p: string): unknown =>
    p.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], bundle);
  let value = walk(path);
  if (value === undefined && opts && "count" in opts) {
    value = walk(`${path}_${opts.count === 1 ? "one" : "other"}`);
  }
  if (typeof value !== "string") return `MISSING(${key})`;
  return value.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(opts?.[k] ?? ""));
}

vi.mock("../../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: lookup,
    i18n: { language: lang.current, changeLanguage: vi.fn(), isInitialized: true },
    ready: true,
  }),
}));
const marks = vi.hoisted(() => ({
  get: vi.fn<(domain: string, name: string) => Promise<unknown>>(),
}));
vi.mock("../../../../../lib/api/operators", async (orig) => ({
  ...(await orig<typeof import("../../../../../lib/api/operators")>()),
  getOperatorMark: (domain: string, name: string) => marks.get(domain, name),
}));
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

const FERRY_BASE = {
  status: "completed",
  operator: "Color Line",
  depStationName: "Kiel",
  depLat: 54.316,
  depLon: 10.135,
  depCountry: "DE",
  arrStationName: "Oslo",
  arrLat: 59.905,
  arrLon: 10.742,
  arrCountry: "NO",
  vesselName: "Color Fantasy",
  cabinType: "Inside",
  departureTime: "2024-07-01T12:00:00Z",
  arrivalTime: "2024-07-02T08:00:00Z",
};

function ferryRoute(): MapPinned {
  const journeys = [
    journeyFromFerry({ ...FERRY_BASE, id: "f1", distanceKm: 670 }),
    journeyFromFerry({ ...FERRY_BASE, id: "f2", distanceKm: null }),
    journeyFromFerry({
      ...FERRY_BASE,
      id: "f3",
      status: "scheduled",
      departureTime: "2030-07-01T12:00:00Z",
    }),
  ];
  return {
    kind: "journeyRoute",
    data: {
      domain: "ferry",
      dep: journeys[0].dep,
      arr: journeys[0].arr,
      journeys,
      color: [86, 134, 184],
    },
    anchorLngLat: [10, 55],
  };
}

function show(pinned: MapPinned): void {
  render(
    <MemoryRouter>
      <PinnedCard pinned={pinned} flights={[]} cruises={[]} onClose={vi.fn()} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  lang.current = "de";
  navigate.mockReset();
  marks.get.mockResolvedValue({ available: false, source: null, credit: null });
});

describe("journey route card", () => {
  it.each(["de", "en"] as const)("renders every string in %s, none missing", (l) => {
    lang.current = l;
    show(ferryRoute());
    expect(document.body.textContent).not.toContain("MISSING(");
    expect(screen.getByText(l === "de" ? "Fähre" : "Ferry")).toBeInTheDocument();
    expect(
      screen.getByText(l === "de" ? "2× übergesetzt · 1× geplant" : "2× crossed · Planned 1×")
    ).toBeInTheDocument();
    // One crossing has no distance: it is named, not added as 0 km.
    expect(
      screen.getByText(l === "de" ? "1 Fahrt ohne Strecke" : "1 journey without distance")
    ).toBeInTheDocument();
    expect(screen.getByText("670 km")).toBeInTheDocument();
  });

  it("carries the domain identity: badge with the ferry icon, both flags, the colour stripe", () => {
    show(ferryRoute());
    expect(screen.getByTestId("journey-domain-badge")).toHaveAttribute("data-icon", "ship");
    const flags = document.querySelectorAll('img[src*="flagcdn"]');
    expect([...flags].map((f) => f.getAttribute("src"))).toEqual(
      expect.arrayContaining([expect.stringContaining("/de."), expect.stringContaining("/no.")])
    );
    expect(screen.getByTestId("journey-heading").style.borderLeft).toContain("rgb(86, 134, 184)");
  });

  it("falls back to a monogram on the domain colour when no operator logo exists", () => {
    show(ferryRoute());
    const tile = screen.getByTestId("operator-tile");
    expect(tile).toHaveTextContent("CL");
    expect(screen.queryByTestId("operator-logo")).toBeNull();
    expect(tile.style.background).toContain("rgb(86, 134, 184)");
  });

  it("shows the ferry's own facts and opens a crossing from the list", () => {
    show(ferryRoute());
    expect(screen.getAllByText(/Color Fantasy/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByTestId("journey-row")[0]);
    expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/ferry\/f\d$/));
  });
});

describe("operator mark with a logo source", () => {
  it("shows a Commons logo with its credit, served by our own endpoint", async () => {
    marks.get.mockResolvedValue({
      available: true,
      source: "wikidata",
      credit: {
        qid: "Q1",
        file: "Color Line logo.svg",
        licence: "Public domain",
        licenceUrl: null,
        artist: "Color Line",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:Color_Line_logo.svg",
        colour: null,
      },
    });
    show(ferryRoute());
    const logo = await screen.findByTestId("operator-logo");
    expect(logo.getAttribute("src")).toBe("/api/v1/operators/logo?domain=ferry&name=Color%20Line");
    const credit = screen.getByTestId("operator-logo-credit");
    expect(credit).toHaveTextContent("Logo: Public domain · Color Line · Wikimedia Commons");
    expect(credit).toHaveAttribute(
      "href",
      "https://commons.wikimedia.org/wiki/File:Color_Line_logo.svg"
    );
  });

  it("shows the rental company's logo, and the monogram once the image fails", async () => {
    marks.get.mockResolvedValue({ available: true, source: "catalogue", credit: null });
    const rental = journeyFromRental({
      id: "c1",
      status: "completed",
      provider: "Sixt",
      pickupStationName: "Faro",
      returnStationName: "Faro",
      pickupLat: 37,
      pickupLon: -8,
      returnLat: 37,
      returnLon: -8,
    });
    show({
      kind: "journeyStop",
      data: { domain: "rental", stop: rental.dep, journeys: [rental], color: [217, 140, 179] },
      anchorLngLat: [-8, 37],
    });
    const logo = await screen.findByTestId("operator-logo", {}, { timeout: 5000 });
    expect(logo.getAttribute("src")).toContain("/operators/logo?domain=rental&name=Sixt");
    // The company's own icon needs no credit line.
    expect(screen.queryByTestId("operator-logo-credit")).toBeNull();
    fireEvent.error(logo);
    expect(screen.queryByTestId("operator-logo")).toBeNull();
    expect(screen.getByTestId("operator-tile")).toHaveTextContent("SI");
  });
});

describe("station card", () => {
  it.each(["de", "en"] as const)("renders in %s with the station kind and the rail badge", (l) => {
    lang.current = l;
    const j = journeyFromRail({
      id: "r1",
      status: "completed",
      depStationName: "Berlin Hbf",
      depLat: 52.525,
      depLon: 13.369,
      depCountry: "DE",
      arrStationName: "Praha hl.n.",
      arrLat: 50.083,
      arrLon: 14.435,
      arrCountry: "CZ",
      trainCategory: "EC",
      trainNumber: "171",
      travelClass: "first",
      distanceKm: 350,
    });
    show({
      kind: "journeyStop",
      data: { domain: "rail", stop: j.dep, journeys: [j], color: [165, 151, 232] },
      anchorLngLat: [13.369, 52.525],
    });
    expect(document.body.textContent).not.toContain("MISSING(");
    expect(screen.getByText(l === "de" ? "Bahnhof" : "Station")).toBeInTheDocument();
    expect(screen.getByTestId("journey-domain-badge")).toHaveAttribute("data-icon", "train-front");
    expect(screen.getByText(/Praha hl\.n\. · 1×/)).toBeInTheDocument();
  });
});

describe("tour card", () => {
  it.each(["de", "en"] as const)("names mode, distance and ascent in %s, opens the tour", (l) => {
    lang.current = l;
    const tour = {
      id: "t1",
      name: "Rund um den Brocken",
      kind: "tour",
      mode: "bike",
      tripName: "Harz 2024",
      distanceKm: 42.4,
      ascentM: 812,
      stopCount: 3,
      date: "2024-08-03",
      startDate: null,
      endDate: null,
    } as unknown as TourSummary;
    show({ kind: "tour", data: tourCardDatum(tour, [169, 196, 106]), anchorLngLat: [10.6, 51.8] });
    expect(document.body.textContent).not.toContain("MISSING(");
    expect(screen.getByTestId("journey-domain-badge")).toHaveAttribute("data-icon", "bike");
    expect(screen.getByText("42 km")).toBeInTheDocument();
    expect(screen.getByText("812 m")).toBeInTheDocument();
    fireEvent.click(screen.getByText(l === "de" ? "Tour öffnen" : "Open tour"));
    expect(navigate).toHaveBeenCalledWith("/tours/t1");
  });
});

describe("a journey's date is the day at its departure, not the reader's", () => {
  // 00:30 in Berlin on 21 October is 22:30 UTC on the 20th; a reader on the
  // default (UTC) profile zone used to see the 20th on every journey card.
  const AT = "2026-10-20T22:30:00Z";
  function stopCard(j: ReturnType<typeof journeyFromFerry>): void {
    show({
      kind: "journeyStop",
      data: { domain: j.domain, stop: j.dep, journeys: [j], color: [86, 134, 184] },
      anchorLngLat: [j.dep.lon, j.dep.lat],
    });
  }

  it("a crossing reads the terminal's day", () => {
    stopCard(
      journeyFromFerry({
        ...FERRY_BASE,
        id: "late",
        depTimezone: "Europe/Berlin",
        departureTime: AT,
        arrivalTime: "2026-10-21T08:00:00Z",
      })
    );
    expect(document.body.textContent).toContain("21.10.2026");
    expect(document.body.textContent).not.toContain("20.10.2026");
  });

  it("a trip's flight reads the airport's day", () => {
    const j = journeyFromTripFlight({
      id: "fl",
      status: "completed",
      depIata: "BER",
      arrIata: "LIS",
      depLat: 52.36,
      depLon: 13.5,
      arrLat: 38.77,
      arrLon: -9.13,
      departureTime: AT,
      depTimezone: "Europe/Berlin",
    });
    if (!j) throw new Error("flight with coordinates must normalise");
    stopCard(j);
    expect(document.body.textContent).toContain("21.10.2026");
    expect(document.body.textContent).not.toContain("20.10.2026");
  });

  it("a rental reads the pick-up station's day", () => {
    stopCard(
      journeyFromRental({
        id: "car",
        status: "completed",
        provider: "Sixt",
        pickupStationName: "Berlin",
        returnStationName: "Berlin",
        pickupLat: 52.5,
        pickupLon: 13.4,
        returnLat: 52.5,
        returnLon: 13.4,
        times: {
          pickup: {
            utc: AT,
            zone: "Europe/Berlin",
            offset: "+02:00",
            local: "2026-10-21T00:30:00",
            precision: "minute",
          },
          return: null,
          actualPickup: null,
          actualReturn: null,
        },
      })
    );
    expect(document.body.textContent).toContain("21.10.2026");
    expect(document.body.textContent).not.toContain("20.10.2026");
  });
});
