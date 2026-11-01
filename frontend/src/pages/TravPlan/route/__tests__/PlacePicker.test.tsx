import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlacePicker } from "../PlacePicker";

const mocks = vi.hoisted(() => ({
  places: vi.fn(),
  t: (key: string, opts?: Record<string, unknown>) =>
    opts ? `${key}:${Object.values(opts).join(",")}` : key,
}));
vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: mocks.t, i18n: { language: "de" } }),
}));
vi.mock("../../../../lib/api/travplan", () => ({ travplanApi: { places: mocks.places } }));

const harbour = {
  source: "port" as const,
  visits: null,
  place: {
    name: "Kiel",
    lat: 54.32,
    lon: 10.14,
    country: "DE",
    zone: "Europe/Berlin",
    ref: { kind: "port" as const, id: "12" },
  },
};
const own = {
  source: "own" as const,
  visits: 2,
  place: { name: "Kiel Strand", lat: 54.4, lon: 10.2, country: "DE", zone: null, ref: null },
};

async function type(text: string) {
  await userEvent.type(screen.getByRole("textbox"), text);
  return screen.findByRole("button", {}, { timeout: 2000 });
}

describe("PlacePicker", () => {
  beforeEach(() => mocks.places.mockReset());

  it("hands back the whole place - name, coordinates, country and zone - not just a label", async () => {
    mocks.places.mockResolvedValue({ places: [harbour], unavailable: [] });
    const onPick = vi.fn();
    render(<PlacePicker label="find" onPick={onPick} />);
    await userEvent.click(await type("kiel"));
    expect(onPick).toHaveBeenCalledWith(harbour.place);
  });

  it("offers the account's own places beside ports, with how often it was there", async () => {
    mocks.places.mockResolvedValue({ places: [harbour, own], unavailable: [] });
    render(<PlacePicker label="find" onPick={vi.fn()} />);
    await userEvent.type(screen.getByRole("textbox"), "kiel");
    expect(await screen.findAllByRole("button", {}, { timeout: 2000 })).toHaveLength(2);
    expect(screen.getByText(/route.search.visits:2/)).toBeInTheDocument();
  });

  it("names a geocoder that is down while the other sources still answer", async () => {
    mocks.places.mockResolvedValue({
      places: [harbour],
      unavailable: [{ source: "geocoder", code: "PLAN_WEATHER_UNAVAILABLE" }],
    });
    render(<PlacePicker label="find" onPick={vi.fn()} />);
    await type("kiel");
    expect(
      screen.getByText(/route.search.unavailable:route.search.source.geocoder/)
    ).toBeInTheDocument();
  });

  it("does not answer 'no matches' when the only source that could answer failed", async () => {
    mocks.places.mockResolvedValue({
      places: [],
      unavailable: [{ source: "geocoder", code: "PLAN_WEATHER_UNAVAILABLE" }],
    });
    render(<PlacePicker label="find" onPick={vi.fn()} />);
    await userEvent.type(screen.getByRole("textbox"), "kiel");
    expect(
      await screen.findByText(/route.search.unavailable/, {}, { timeout: 2000 })
    ).toBeInTheDocument();
    expect(screen.queryByText("route.search.none")).not.toBeInTheDocument();
  });

  it("says a failed request failed, with its own reason", async () => {
    const limit = Object.assign(new Error("limit"), {
      response: { status: 429, data: { code: "PLAN_DAILY_LIMIT" } },
    });
    mocks.places.mockRejectedValueOnce(limit);
    render(<PlacePicker label="find" onPick={vi.fn()} />);
    await userEvent.type(screen.getByRole("textbox"), "kiel");
    expect(await screen.findByRole("alert", {}, { timeout: 2000 })).toHaveTextContent(
      "route.search.failed:errors.PLAN_DAILY_LIMIT"
    );
  });
});
