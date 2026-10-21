import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import deMap from "../../../../../i18n/resources/de/map.json";
import enMap from "../../../../../i18n/resources/en/map.json";
import deRail from "../../../../../i18n/resources/de/rail.json";
import enRail from "../../../../../i18n/resources/en/rail.json";
import deFerry from "../../../../../i18n/resources/de/ferry.json";
import enFerry from "../../../../../i18n/resources/en/ferry.json";
import deRental from "../../../../../i18n/resources/de/rental.json";
import enRental from "../../../../../i18n/resources/en/rental.json";
import deCommon from "../../../../../i18n/resources/de/common.json";
import enCommon from "../../../../../i18n/resources/en/common.json";
import { PinnedCard } from "../../PinnedCard";
import type { MapPinned } from "../../pinnedTypes";
import { journeyFromFerry, journeyFromRental } from "../journeyNormalize";
import type { MapJourney } from "../journeyTypes";
import type { TimeValue } from "../../../../../shared/time";

/**
 * The route card's own statistics, rendered from the REAL DE and EN bundles:
 * what each figure prints, that an underivable one prints nothing, and that
 * money stays in its currency.
 */

const BUNDLES = {
  de: { map: deMap, rail: deRail, ferry: deFerry, rental: deRental, common: deCommon },
  en: { map: enMap, rail: enRail, ferry: enFerry, rental: enRental, common: enCommon },
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
vi.mock("../../../../../lib/api/operators", async (orig) => ({
  ...(await orig<typeof import("../../../../../lib/api/operators")>()),
  getOperatorMark: () => Promise.resolve({ available: false, source: null, credit: null }),
}));
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

function tv(local: string, utc: string, zone: string, offset: string): TimeValue {
  return { utc, zone, offset, local, precision: "minute" };
}

const KIEL = { utc: "Europe/Berlin", offset: "+02:00" };
const OSLO = { utc: "Europe/Oslo", offset: "+02:00" };

function crossing(id: string, day: number, hours: number, delay: number | null): MapJourney {
  const dep = `2024-08-${String(day).padStart(2, "0")}T12:00:00Z`;
  const arrMs = Date.parse(dep) + hours * 3_600_000;
  const arr = new Date(arrMs).toISOString().replace(".000", "");
  const local = (iso: string) => new Date(Date.parse(iso) + 2 * 3_600_000).toISOString();
  return journeyFromFerry({
    id,
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
    departureTime: dep,
    arrivalTime: arr,
    distanceKm: 684,
    distanceSource: "sea_route",
    delayMinutes: delay,
    times: {
      departure: tv(local(dep).slice(0, 19), dep, KIEL.utc, KIEL.offset),
      arrival: tv(local(arr).slice(0, 19), arr, OSLO.utc, OSLO.offset),
      actualDeparture: null,
      actualArrival: null,
    },
  } as Parameters<typeof journeyFromFerry>[0]);
}

function route(journeys: MapJourney[], domain: MapJourney["domain"] = "ferry"): MapPinned {
  return {
    kind: "journeyRoute",
    data: { domain, dep: journeys[0].dep, arr: journeys[0].arr, journeys, color: [86, 134, 184] },
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

function rowValue(label: string): string | null {
  const labelEl = screen.queryByText(label);
  return labelEl?.parentElement?.lastElementChild?.textContent ?? null;
}

beforeEach(() => {
  lang.current = "de";
  navigate.mockReset();
});

describe("ferry route card figures", () => {
  it.each(["de", "en"] as const)("prints every figure in %s, none missing", (l) => {
    lang.current = l;
    show(route([crossing("a", 1, 20, 30), crossing("b", 10, 22, 0), crossing("c", 20, 18, null)]));
    expect(document.body.textContent).not.toContain("MISSING(");
    const de = l === "de";
    expect(screen.getByText(de ? "Ø Dauer" : "Avg. duration")).toBeInTheDocument();
    expect(rowValue(de ? "Ø Dauer" : "Avg. duration")).toContain(de ? "3 Fahrten" : "3 journeys");
    expect(screen.getByText(de ? "Schnellste" : "Fastest")).toBeInTheDocument();
    expect(screen.getByText(de ? "Langsamste" : "Slowest")).toBeInTheDocument();
    expect(rowValue(de ? "Ø Verspätung" : "Avg. delay")).toBe(
      de ? "+15 min (2 Fahrten)" : "+15 min (2 journeys)"
    );
    expect(screen.getByText(de ? "Erstmals" : "First")).toBeInTheDocument();
    expect(screen.getByTestId("journey-distance-source")).toHaveTextContent(
      de ? "Seeweg (Schätzung)" : "Sea route (estimate)"
    );
  });

  it("omits the delay row when no crossing recorded one — unknown is not 'on time'", () => {
    show(route([crossing("a", 1, 20, null), crossing("b", 10, 22, null)]));
    expect(screen.queryByText("Ø Verspätung")).toBeNull();
    expect(screen.queryByText("pünktlich")).toBeNull();
  });

  it("names the arrival's day when an overnight crossing lands on the next one", () => {
    show(route([crossing("a", 10, 20, null)]));
    const last = rowValue("Zuletzt") ?? "";
    expect(last).toContain("→");
  });
});

function rentalRow(id: string, over: Record<string, unknown>): MapJourney {
  const pickup = "2024-05-01T09:00:00Z";
  const ret = "2024-05-05T09:00:00Z";
  return journeyFromRental({
    id,
    status: "completed",
    provider: "Sixt",
    pickupStationName: "Faro Airport",
    returnStationName: "Lisboa Airport",
    pickupLat: 37.02,
    pickupLon: -7.97,
    returnLat: 38.77,
    returnLon: -9.13,
    pickupTimezone: "Europe/Lisbon",
    returnTimezone: "Europe/Lisbon",
    distanceKm: 400,
    distanceSource: "invoice",
    odometerOutKm: null,
    odometerInKm: null,
    price: null,
    currency: null,
    finalAmount: null,
    finalCurrency: null,
    times: {
      pickup: tv("2024-05-01T10:00:00", pickup, "Europe/Lisbon", "+01:00"),
      return: tv("2024-05-05T10:00:00", ret, "Europe/Lisbon", "+01:00"),
      actualPickup: null,
      actualReturn: null,
    },
    ...over,
  } as Parameters<typeof journeyFromRental>[0]);
}

describe("rental route card figures", () => {
  it.each(["de", "en"] as const)("prints km and cost per day per currency in %s", (l) => {
    lang.current = l;
    show(
      route(
        [
          rentalRow("a", { price: 200, currency: "EUR" }),
          rentalRow("b", { price: 300, currency: "USD" }),
        ],
        "rental"
      )
    );
    expect(document.body.textContent).not.toContain("MISSING(");
    const de = l === "de";
    expect(rowValue(de ? "km pro Tag" : "km per day")).toBe("100 km");
    const perDay = rowValue(de ? "Kosten pro Tag" : "Cost per day") ?? "";
    // Two currencies, two figures — never one sum.
    expect(perDay).toMatch(/50/);
    expect(perDay).toMatch(/75/);
    expect(perDay).not.toMatch(/125/);
    expect(screen.getByText(de ? "Miettage" : "Rental days", { exact: false })).toBeTruthy();
    expect(rowValue(de ? "Strecke" : "Distance")).toBe("800 km");
    expect(screen.getByTestId("journey-distance-source")).toHaveTextContent(
      de ? "laut Rechnung" : "from the invoice"
    );
  });

  it("omits cost rows for rentals without a price", () => {
    show(route([rentalRow("a", {})], "rental"));
    expect(screen.queryByText("Kosten pro Tag")).toBeNull();
    expect(screen.queryByText("Kosten pro km")).toBeNull();
  });

  it("offers to open the latest rental, as every other route card does", () => {
    show(route([rentalRow("a", {})], "rental"));
    const actions = screen.getByRole("button", { name: "Letzte öffnen" });
    within(actions.parentElement!).getByText("Letzte öffnen").click();
    expect(navigate).toHaveBeenCalledWith("/rentals/a");
  });
});

describe("a rental that went back to its own branch", () => {
  it("opens as the branch's card and still offers to open the latest rental", () => {
    const round = journeyFromRental({
      id: "r9",
      status: "completed",
      provider: "Sixt",
      pickupStationName: "Faro Airport",
      returnStationName: "Faro Airport",
      pickupLat: 37.02,
      pickupLon: -7.97,
      returnLat: 37.02,
      returnLon: -7.97,
      pickupTimezone: "Europe/Lisbon",
      returnTimezone: "Europe/Lisbon",
    } as Parameters<typeof journeyFromRental>[0]);
    show({
      kind: "journeyStop",
      data: { domain: "rental", stop: round.dep, journeys: [round], color: [217, 140, 179] },
      anchorLngLat: [-7.97, 37.02],
    });
    screen.getByRole("button", { name: "Letzte öffnen" }).click();
    expect(navigate).toHaveBeenCalledWith("/rentals/r9");
  });
});
