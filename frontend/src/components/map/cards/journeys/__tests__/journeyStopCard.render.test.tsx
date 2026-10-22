import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import deMap from "../../../../../i18n/resources/de/map.json";
import enMap from "../../../../../i18n/resources/en/map.json";
import deRail from "../../../../../i18n/resources/de/rail.json";
import enRail from "../../../../../i18n/resources/en/rail.json";
import deFerry from "../../../../../i18n/resources/de/ferry.json";
import enFerry from "../../../../../i18n/resources/en/ferry.json";
import deRental from "../../../../../i18n/resources/de/rental.json";
import enRental from "../../../../../i18n/resources/en/rental.json";
import deOpenData from "../../../../../i18n/resources/de/openData.json";
import enOpenData from "../../../../../i18n/resources/en/openData.json";
import deCommon from "../../../../../i18n/resources/de/common.json";
import enCommon from "../../../../../i18n/resources/en/common.json";
import { PinnedCard } from "../../PinnedCard";
import { journeyFromFerry } from "../journeyNormalize";
import { useSettingsStore } from "../../../../../store/settingsStore";

vi.unmock("../../../../../store/settingsStore");

const details = vi.hoisted(() => ({ stop: vi.fn(), subject: vi.fn() }));
vi.mock("../../../../../lib/api/mapDetails", async (orig) => ({
  ...(await orig<typeof import("../../../../../lib/api/mapDetails")>()),
  getStopInfo: details.stop,
  getSubjectImage: details.subject,
}));

/**
 * The station card (owner, 2026-10-21): departures, destinations and the last
 * visit here; the station's Wikipedia photo and sentences — or, when
 * Wikipedia could not be asked, a line that says so; and on a route card the
 * credited picture of the ship, which vanishes rather than breaks.
 */

const BUNDLES = {
  de: {
    map: deMap,
    rail: deRail,
    ferry: deFerry,
    rental: deRental,
    openData: deOpenData,
    common: deCommon,
  },
  en: {
    map: enMap,
    rail: enRail,
    ferry: enFerry,
    rental: enRental,
    openData: enOpenData,
    common: enCommon,
  },
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

const CROSSINGS_INPUT = {
  status: "completed",
  operator: "Color Line",
  vesselName: "Color Fantasy",
  depStationName: "Kiel",
  depLat: 54.316,
  depLon: 10.135,
  depCountry: "DE",
  arrStationName: "Oslo",
  arrLat: 59.905,
  arrLon: 10.742,
  arrCountry: "NO",
};
const CROSSINGS = [1, 2].map((n) =>
  journeyFromFerry({ ...CROSSINGS_INPUT, id: `f${n}` } as Parameters<typeof journeyFromFerry>[0])
);

function showStop(): void {
  render(
    <MemoryRouter>
      <PinnedCard
        pinned={{
          kind: "journeyStop",
          data: {
            domain: "ferry",
            stop: CROSSINGS[0].dep,
            journeys: CROSSINGS,
            color: [86, 134, 184],
          },
          anchorLngLat: [10.135, 54.316],
        }}
        flights={[]}
        cruises={[]}
        onClose={vi.fn()}
      />
    </MemoryRouter>
  );
}

function showRoute(): void {
  render(
    <MemoryRouter>
      <PinnedCard
        pinned={{
          kind: "journeyRoute",
          data: {
            domain: "ferry",
            dep: CROSSINGS[0].dep,
            arr: CROSSINGS[0].arr,
            journeys: CROSSINGS,
            color: [86, 134, 184],
          },
          anchorLngLat: [10, 55],
        }}
        flights={[]}
        cruises={[]}
        onClose={vi.fn()}
      />
    </MemoryRouter>
  );
}

beforeEach(() => {
  lang.current = "de";
  navigate.mockReset();
  details.stop.mockReset();
  details.subject.mockReset();
  details.subject.mockResolvedValue({ available: false, credit: null });
  useSettingsStore.setState({ openDataEnabled: true });
});

describe("station card", () => {
  it.each(["de", "en"] as const)(
    "names departures, destinations and the last visit in %s",
    async (l) => {
      lang.current = l;
      details.stop.mockResolvedValue({ state: "none" });
      showStop();
      expect(document.body.textContent).not.toContain("MISSING(");
      const de = l === "de";
      expect(screen.getByText(de ? "Abfahrten von hier" : "Departures from here")).toBeTruthy();
      expect(screen.getByText("Oslo 2×")).toBeInTheDocument();
      // The lookup answered "no article": nothing about Wikipedia is drawn.
      await screen.findByText("Oslo 2×");
      await Promise.resolve();
      expect(screen.queryByTestId("stop-wikipedia")).toBeNull();
    }
  );

  // Codex review before 2.7.0-rc.20: an overnight crossing with no recorded
  // arrival made its port say "last here" on the departure's day.
  it.each(["de", "en"] as const)(
    "says the last visit is unknown after a crossing with no arrival, in %s",
    async (l) => {
      lang.current = l;
      details.stop.mockResolvedValue({ state: "none" });
      const night = journeyFromFerry({
        ...(CROSSINGS_INPUT as object),
        id: "night",
        times: {
          departure: {
            utc: "2024-10-01T17:00:00Z",
            zone: "Europe/Berlin",
            offset: "+02:00",
            local: "2024-10-01T19:00:00",
            precision: "minute",
          },
          arrival: null,
          actualDeparture: null,
          actualArrival: null,
        },
      } as Parameters<typeof journeyFromFerry>[0]);
      render(
        <MemoryRouter>
          <PinnedCard
            pinned={{
              kind: "journeyStop",
              data: { domain: "ferry", stop: night.arr, journeys: [night], color: [86, 134, 184] },
              anchorLngLat: [10.742, 59.905],
            }}
            flights={[]}
            cruises={[]}
            onClose={vi.fn()}
          />
        </MemoryRouter>
      );
      expect(document.body.textContent).not.toContain("MISSING(");
      const row = (await screen.findByText(l === "de" ? "Zuletzt hier" : "Last here"))
        .parentElement;
      expect(row?.textContent).toMatch(
        l === "de" ? /unbekannt \(ab .*2024/ : /unknown \(on or after .*2024/
      );
      await act(async () => {
        await Promise.resolve();
      });
    }
  );

  it("shows the station's Wikipedia photo and sentences, credited", async () => {
    details.stop.mockResolvedValue({
      state: "found",
      summary: {
        title: "Kieler Hafen",
        extract: "Der Kieler Hafen ist ein Seehafen.",
        thumbnailUrl: "https://upload.wikimedia.org/k.jpg",
        pageUrl: "https://de.wikipedia.org/wiki/Kieler_Hafen",
        lang: "de",
      },
    });
    showStop();
    expect(await screen.findByText("Der Kieler Hafen ist ein Seehafen.")).toBeInTheDocument();
    expect(screen.getByText("Text: Wikipedia, CC BY-SA 4.0").closest("a")).toHaveAttribute(
      "href",
      "https://de.wikipedia.org/wiki/Kieler_Hafen"
    );
    expect(details.stop).toHaveBeenCalledWith(
      "ferry",
      { name: "Kiel", lat: 54.316, lon: 10.135 },
      "de"
    );
  });

  // beta.23 UAT before 2.7.0-rc.20: the Hamburg ZOB photo carried no credit,
  // only "Text: Wikipedia". The photo names its author and licence and links
  // its file page, like the subject pictures; a photo without one is not shown.
  it("credits the station photo's author and licence, linked to its file page", async () => {
    details.stop.mockResolvedValue({
      state: "found",
      summary: {
        title: "Kieler Hafen",
        extract: "Der Kieler Hafen ist ein Seehafen.",
        thumbnailUrl: "https://upload.wikimedia.org/wikipedia/commons/a/ab/K.jpg",
        pageUrl: "https://de.wikipedia.org/wiki/Kieler_Hafen",
        lang: "de",
        imageCredit: {
          file: "K.jpg",
          licence: "CC BY-SA 4.0",
          licenceUrl: null,
          artist: "Jo Beispiel",
          sourceUrl: "https://commons.wikimedia.org/wiki/File:K.jpg",
          onCommons: true,
        },
      },
    });
    showStop();
    const credit = await screen.findByText("Bild: CC BY-SA 4.0 · Jo Beispiel · Wikimedia Commons");
    expect(credit.closest("a")).toHaveAttribute(
      "href",
      "https://commons.wikimedia.org/wiki/File:K.jpg"
    );
  });

  it("shows no station photo it cannot credit", async () => {
    details.stop.mockResolvedValue({
      state: "found",
      summary: {
        title: "Kieler Hafen",
        extract: "Der Kieler Hafen ist ein Seehafen.",
        thumbnailUrl: "https://upload.wikimedia.org/k.jpg",
        pageUrl: "https://de.wikipedia.org/wiki/Kieler_Hafen",
        lang: "de",
        imageCredit: null,
      },
    });
    showStop();
    await screen.findByText("Der Kieler Hafen ist ein Seehafen.");
    expect(screen.getByTestId("stop-wikipedia").querySelector("img")).toBeNull();
  });

  // beta.23 UAT before 2.7.0-rc.20: on an iPad the pinned card's ✕ was
  // 16×11 px, under the 44 px a finger needs.
  it("gives the card's close button the 44 px touch minimum under a coarse pointer", async () => {
    details.stop.mockResolvedValue({ state: "none" });
    showStop();
    const close = await screen.findByRole("button", { name: "Schließen" });
    await act(async () => undefined);
    expect(close.className).toContain("pointer-coarse:min-h-(--ts-size-touch-min)");
    expect(close.className).toContain("pointer-coarse:min-w-(--ts-size-touch-min)");
  });

  it("says Wikipedia could not be asked, instead of looking like 'no article'", async () => {
    details.stop.mockResolvedValue({ state: "unavailable" });
    showStop();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Wikipedia ist gerade nicht erreichbar."
    );
  });

  it("asks nothing while the instance's open-data switch is off", () => {
    useSettingsStore.setState({ openDataEnabled: false });
    showStop();
    expect(details.stop).not.toHaveBeenCalled();
  });
});

describe("route card picture", () => {
  it("shows the ship's picture with its credit, and drops it if it fails to load", async () => {
    details.subject.mockResolvedValue({
      available: true,
      credit: {
        qid: "Q1",
        file: "Color Fantasy.jpg",
        licence: "CC BY-SA 4.0",
        licenceUrl: null,
        artist: "Jane Doe",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:Color_Fantasy.jpg",
      },
    });
    showRoute();
    const figure = await screen.findByTestId("subject-picture");
    expect(figure.querySelector("img")?.getAttribute("src")).toContain(
      "/map-details/subject/image?kind=vessel&name=Color%20Fantasy"
    );
    expect(figure).toHaveTextContent("Bild: CC BY-SA 4.0 · Jane Doe · Wikimedia Commons");
    fireEvent.error(figure.querySelector("img")!);
    expect(screen.queryByTestId("subject-picture")).toBeNull();
    // The card itself stays.
    expect(screen.getByText("2× übergesetzt")).toBeInTheDocument();
  });

  it("says the picture is unavailable when Wikimedia could not be asked", async () => {
    details.subject.mockResolvedValue({ available: false, unavailable: true, credit: null });
    showRoute();
    expect(await screen.findByTestId("subject-picture-unavailable")).toHaveTextContent(
      "Bild gerade nicht verfügbar."
    );
    expect(screen.queryByTestId("subject-picture")).toBeNull();
  });

  it("draws nothing when there is no picture", async () => {
    showRoute();
    await Promise.resolve();
    expect(screen.queryByTestId("subject-picture")).toBeNull();
  });
});
