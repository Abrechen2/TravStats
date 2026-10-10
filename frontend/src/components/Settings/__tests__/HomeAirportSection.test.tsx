import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * "Zuhause" settings (owner decision 2026-09-27): confirming a migrated
 * residence, picking home airports from the nearby offer or the search, and
 * every failure path saying what went wrong in German — never a raw code.
 */

vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

const { getHomeAirports, saveHomePeriods, nearbyHomeAirports, addToast } = vi.hoisted(() => ({
  getHomeAirports: vi.fn(),
  saveHomePeriods: vi.fn(),
  nearbyHomeAirports: vi.fn(),
  addToast: vi.fn(),
}));
vi.mock("../../../lib/api", () => ({
  settingsApi: { getHomeAirports, saveHomePeriods, nearbyHomeAirports },
}));
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (select: (s: { addToast: typeof addToast }) => unknown) => select({ addToast }),
}));
vi.mock("../../../hooks/useTodayZone", () => ({ todayZoneNow: () => "Europe/Berlin" }));
// The place search and the airport search are their own components with their
// own tests; here each is a button that hands over what a pick would.
vi.mock("../../location/LocationInput", () => ({
  LocationInput: ({ onChange }: { onChange: (s: object) => void }) => (
    <button type="button" onClick={() => onChange({ lat: 50.9375, lon: 6.9603, city: "Köln" })}>
      pick-koeln
    </button>
  ),
}));
vi.mock("../../AirportAutocomplete", () => ({
  default: ({ onChange }: { onChange: (a: object) => void }) => (
    <button type="button" onClick={() => onChange({ iata: "nrn", name: "Weeze", lat: 0, lon: 0 })}>
      pick-nrn
    </button>
  ),
}));

import HomeAirportSection from "../HomeAirportSection";
import { allNamed, findNamed, getNamed, queryNamed } from "../../../__tests__/helpers/namedElement";

const CGN_AIRPORT = { name: "Köln/Bonn", lat: 50.8659, lon: 7.1427 };
const MIGRATED = {
  fromDate: "2020-01-01",
  toDate: null,
  residence: CGN_AIRPORT,
  residenceConfirmed: false,
  airports: [{ code: "CGN", primary: true }],
};
const NEARBY = [
  { code: "CGN", name: "Cologne Bonn Airport", city: "Köln", distanceKm: 15 },
  { code: "DUS", name: "Düsseldorf Airport", city: "Düsseldorf", distanceKm: 54 },
  { code: "NRN", name: "Weeze Airport", city: "Weeze", distanceKm: 95 },
  { code: "DTM", name: "Dortmund Airport", city: "Dortmund", distanceKm: 80 },
];

const axiosError = (status: number, data: object) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data },
  });

describe("HomeAirportSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getHomeAirports.mockResolvedValue({ history: [], periods: [MIGRATED] });
    nearbyHomeAirports.mockResolvedValue(NEARBY);
    saveHomePeriods.mockImplementation(async (periods) => ({ history: [], periods }));
  });

  it("confirms a migrated residence with a second home airport from the nearby offer", async () => {
    const user = userEvent.setup();
    render(<HomeAirportSection />);
    expect(await screen.findByText("Bitte bestätige deinen Wohnort")).toBeInTheDocument();
    await user.click(allNamed("button", "Bestätigen")[0]);

    await user.click(getNamed("button", "pick-koeln"));
    await user.click(await screen.findByRole("checkbox", { name: /DUS/ }));
    await user.click(getNamed("button", "Speichern"));

    await waitFor(() => expect(saveHomePeriods).toHaveBeenCalledTimes(1));
    expect(saveHomePeriods.mock.calls[0][0]).toEqual([
      {
        fromDate: "2020-01-01",
        toDate: null,
        residence: { name: "Köln", lat: 50.9375, lon: 6.9603, placeRef: null },
        residenceConfirmed: true,
        airports: [
          { code: "CGN", primary: true },
          { code: "DUS", primary: false },
        ],
      },
    ]);
    await waitFor(() => expect(screen.queryByText("Bitte bestätige deinen Wohnort")).toBeNull());
  });

  it("says so when the nearby offer fails, and keeps the airport search", async () => {
    nearbyHomeAirports.mockRejectedValue(axiosError(500, { error: "Internal" }));
    const user = userEvent.setup();
    render(<HomeAirportSection />);
    await user.click((await screen.findAllByRole("button", { name: "Bestätigen" }))[0]);
    expect(
      await screen.findByText(
        "Flughäfen in der Nähe konnten nicht geladen werden. Du kannst deinen Flughafen unten suchen."
      )
    ).toBeInTheDocument();
    await user.click(getNamed("button", "pick-nrn"));
    expect(screen.getByText("NRN")).toBeInTheDocument();
  });

  it("stops at three airports", async () => {
    const user = userEvent.setup();
    render(<HomeAirportSection />);
    await user.click((await screen.findAllByRole("button", { name: "Bestätigen" }))[0]);
    await user.click(await screen.findByRole("checkbox", { name: /DUS/ }));
    await user.click(screen.getByRole("checkbox", { name: /NRN/ }));
    expect(screen.getByText("Höchstens drei Heimatflughäfen.")).toBeInTheDocument();
    expect(queryNamed("button", "pick-nrn")).toBeNull();
    expect(screen.getByRole("checkbox", { name: /DTM/ })).toBeDisabled();
  });

  it("maps a refused airport to German copy, never the code or axios's sentence", async () => {
    saveHomePeriods.mockRejectedValue(
      axiosError(400, { error: "HOME_AIRPORT_UNKNOWN", codes: ["QQX"] })
    );
    const user = userEvent.setup();
    render(<HomeAirportSection />);
    await user.click((await screen.findAllByRole("button", { name: "Bestätigen" }))[0]);
    await user.click(getNamed("button", "Speichern"));
    const message = "Diesen Flughafen kennt der Katalog nicht: QQX.";
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(addToast).toHaveBeenCalledWith("error", message);
    expect(screen.queryByText(/HOME_AIRPORT_UNKNOWN|status code/)).toBeNull();
    // The editor stays open: nothing the user entered is thrown away.
    expect(screen.getByTestId("home-period-editor")).toBeInTheDocument();
  });

  it("refuses a move dated before the current home began, without calling the server", async () => {
    getHomeAirports.mockResolvedValue({
      history: [],
      periods: [{ ...MIGRATED, fromDate: "2026-01-01", residenceConfirmed: true }],
    });
    const user = userEvent.setup();
    render(<HomeAirportSection />);
    await user.click(await findNamed("button", "Ich bin umgezogen"));
    await user.click(getNamed("button", "pick-koeln"));
    await user.click(await screen.findByRole("checkbox", { name: /DUS/ }));
    const from = screen.getByLabelText("Ab wann gilt das?");
    await user.clear(from);
    await user.type(from, "2025-06-01");
    await user.click(getNamed("button", "Speichern"));
    expect(await screen.findByText(/Der Umzug muss nach dem Beginn/)).toBeInTheDocument();
    expect(saveHomePeriods).not.toHaveBeenCalled();
  });

  it("says so when the home cannot be loaded, instead of offering to set a new one", async () => {
    getHomeAirports.mockRejectedValue(axiosError(500, {}));
    render(<HomeAirportSection />);
    expect(
      await screen.findByText("Dein Zuhause konnte nicht geladen werden.")
    ).toBeInTheDocument();
    expect(queryNamed("button", "Zuhause festlegen")).toBeNull();
  });
});
