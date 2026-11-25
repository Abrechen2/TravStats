import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NearbyLodging } from "../../../../lib/api/openData";
import { NightSuggestions, rankLodging } from "../NightSuggestions";
import { place } from "./routeFixture";

// A vi.fn() that returns a rejected promise is reported as a failure by Vitest 5.1 even when
// the component catches it, so the failure path rejects from a plain function.
const mocks = vi.hoisted(() => ({ nearby: vi.fn(), fail: false }));
vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && !("defaultValue" in opts) ? `${key}:${Object.values(opts).join(",")}` : key,
  }),
}));
vi.mock("../../../../lib/logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("../../../../lib/units", () => ({ appLocale: () => "de-DE" }));
vi.mock("../../../../lib/api/openData", async (orig) => ({
  ...(await orig<typeof import("../../../../lib/api/openData")>()),
  openDataApi: {
    nearbyLodgings: (...a: unknown[]) =>
      mocks.fail ? Promise.reject(new Error("boom")) : mocks.nearby(...a),
  },
}));

const lodging = (name: string, kind: string, distanceM: number): NearbyLodging => ({
  name,
  kind,
  lat: 38.1,
  lon: 13.3,
  distanceM,
  osmRef: "node/" + name,
  website: null,
  stars: null,
  brand: null,
  chain: null,
});
const hotel = lodging("Hotel Centrale", "hotel", 300),
  camp = lodging("Camping Lilybeo", "camp_site", 4200),
  pitch = lodging("Area Sosta Mare", "caravan_site", 1500),
  pension = lodging("B&B Rosa", "guest_house", 800);

describe("rankLodging", () => {
  it("puts campsites and pitches first for a motorhome, nearest first", () => {
    expect(rankLodging([hotel, camp, pitch], "motorhome").map((p) => p.name)).toEqual([
      "Area Sosta Mare",
      "Camping Lilybeo",
      "Hotel Centrale",
    ]);
  });

  it("puts houses first without a camping vehicle and drops nothing", () => {
    expect(rankLodging([camp, hotel, pitch], null).map((p) => p.name)).toEqual([
      "Hotel Centrale",
      "Area Sosta Mare",
      "Camping Lilybeo",
    ]);
  });
});

describe("NightSuggestions", () => {
  const palermo = place("Palermo", 38.1, 13.36);
  beforeEach(() => {
    mocks.nearby.mockReset();
    mocks.fail = false;
  });

  it("offers three at a time and hands a picked place over as a night candidate", async () => {
    mocks.nearby.mockResolvedValue([hotel, camp, pitch, pension]);
    const onTake = vi.fn();
    render(<NightSuggestions near={palermo} vehicle="motorhome" taken={[]} onTake={onTake} />);
    await userEvent.click(screen.getByRole("button", { name: /route.suggest.search/ }));
    const list = await screen.findByRole("list", { name: "route.suggest.list" });
    expect(list.querySelectorAll("li")).toHaveLength(3);
    expect(list).toHaveTextContent("route.suggest.distance:1,5");
    await userEvent.click(screen.getByRole("button", { name: "route.suggest.more" }));
    expect(list.querySelectorAll("li")).toHaveLength(4);
    await userEvent.click(
      screen.getByRole("button", { name: "route.suggest.take:Camping Lilybeo" })
    );
    expect(onTake).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Camping Lilybeo",
        place: expect.objectContaining({ lat: 38.1, lon: 13.3, zone: "Europe/Berlin" }),
      })
    );
  });

  it("does not offer a place that is already a candidate", async () => {
    mocks.nearby.mockResolvedValue([hotel]);
    render(
      <NightSuggestions near={palermo} vehicle={null} taken={["Hotel Centrale"]} onTake={vi.fn()} />
    );
    await userEvent.click(screen.getByRole("button", { name: /route.suggest.search/ }));
    expect(await screen.findByText("route.suggest.none:10")).toBeInTheDocument();
  });

  it("says OpenStreetMap could not be asked instead of claiming nothing is near", async () => {
    mocks.fail = true;
    render(<NightSuggestions near={palermo} vehicle={null} taken={[]} onTake={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /route.suggest.search/ }));
    expect(await screen.findByText("route.suggest.failed.unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/route.suggest.none/)).not.toBeInTheDocument();
  });
});
