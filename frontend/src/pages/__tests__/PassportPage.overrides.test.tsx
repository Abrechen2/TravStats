import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import type { Passport, PassportCountry } from "../../types/passport";

vi.mock("../../hooks/useBetaFeatures", () => ({
  useBetaFeatureAccess: () => "allowed",
  useBetaFeatures: () => ({ betaFeaturesEnabled: true, isFeatureVisible: () => true }),
}));

// A STABLE `isEnabled`: the page refetches whenever it changes, and a new
// function per render would refetch on every render.
const domains = vi.hoisted(() => ({ enabled: ["flight"], isEnabled: () => true }));
vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => domains,
}));

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));

const getPassportMock = vi.fn();
const getCountryDetailMock = vi.fn();
vi.mock("../../lib/api", () => ({
  statsApi: {
    getPassport: () => getPassportMock(),
    getCountryDetail: (code: string) => getCountryDetailMock(code),
  },
}));

const listMock = vi.fn();
const saveMock = vi.fn();
const removeMock = vi.fn();
vi.mock("../../lib/api/passportOverrides", () => ({
  passportOverridesApi: {
    list: () => listMock(),
    save: (code: string, input: unknown) => saveMock(code, input),
    remove: (code: string) => removeMock(code),
  },
}));

import PassportPage from "../PassportPage";

/**
 * forgejo#308 — adding, correcting, deleting and restoring a country by hand
 * from the passport page, and every way that can fail being said as itself.
 * The i18n mock returns keys, so the copy is asserted by its key.
 */

const country = (over: Partial<PassportCountry>): PassportCountry => ({
  code: "DE",
  continent: "Europe",
  entries: 4,
  firstYear: 2019,
  lastYear: 2024,
  airports: ["MUC"],
  isHome: false,
  isNew: false,
  evidence: "flight",
  tier: "visited",
  kinds: ["flight"],
  hasUndatedEvidence: false,
  daysPresent: 9,
  groundTime: { state: "measured", minutes: 282 },
  counted: true,
  override: null,
  ...over,
});

const passport = (countries: PassportCountry[], over: Partial<Passport> = {}): Passport => ({
  summary: {
    countries: countries.filter((c) => c.counted).length,
    countriesTotal: countries.length,
    legacyCountries: countries.length,
    countryThreshold: "visited",
    airports: 1,
    entries: 4,
    continentsVisited: 1,
    continentsTotal: 7,
    firstStampYear: 2019,
    newThisYear: 0,
    byEvidence: { flight: 1, port: 0, place: 0, lodging: 0, rail: 0, roadtrip: 0, track: 0 },
    byTier: { slept: 0, visited: 1, transited: 0, connection: 0 },
  },
  countries,
  excludedCountries: [],
  continents: [],
  groups: [],
  stamps: [],
  ...over,
});

const MANUAL_PT = country({
  code: "PT",
  entries: 0,
  airports: [],
  evidence: "manual",
  kinds: ["manual"],
  override: { verdict: "visited", note: "Lisbon weekend", day: "2019-05-04" },
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <PassportPage />
    </MemoryRouter>
  );

const dialog = () => screen.findByTestId("country-override-dialog");

describe("PassportPage — country overrides (forgejo#308)", () => {
  beforeEach(() => {
    getPassportMock.mockReset();
    getCountryDetailMock.mockReset();
    listMock.mockReset();
    saveMock.mockReset();
    removeMock.mockReset();
    listMock.mockResolvedValue({ overrides: [], knownCountries: ["AT", "PT"] });
  });

  it("adds a country by hand, reloads the passport and labels the row in words", async () => {
    getPassportMock
      .mockResolvedValueOnce(passport([country({})]))
      .mockResolvedValueOnce(passport([country({}), MANUAL_PT]));
    saveMock.mockResolvedValue({});
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "passport:overrides.add" }));
    const d = await dialog();
    const select = within(d).getByLabelText("passport:overrides.country");
    await waitFor(() =>
      expect(within(select).getByRole("option", { name: "Portugal" })).toBeInTheDocument()
    );
    await user.selectOptions(select, "PT");
    expect(
      within(d).getByRole("radio", { name: /passport:overrides.verdict.visited/ })
    ).toBeChecked();
    await user.type(within(d).getByLabelText("passport:overrides.note"), "Lisbon weekend");
    await user.type(within(d).getByLabelText("passport:overrides.day"), "2019-05-04");
    await user.click(within(d).getByRole("button", { name: "passport:overrides.save" }));

    await waitFor(() =>
      expect(saveMock).toHaveBeenCalledWith("PT", {
        verdict: "visited",
        note: "Lisbon weekend",
        day: "2019-05-04",
      })
    );
    await waitFor(() => expect(screen.queryByTestId("country-override-dialog")).toBeNull());
    expect(getPassportMock).toHaveBeenCalledTimes(2);
    const row = (await screen.findByText("Portugal")).closest("tr")!;
    expect(within(row).getByTestId("override-label")).toHaveTextContent(
      "passport:overrides.labelManual"
    );
  });

  it("asks for a country and a note instead of saving without them", async () => {
    getPassportMock.mockResolvedValue(passport([country({})]));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "passport:overrides.add" }));
    const d = await dialog();
    await user.click(within(d).getByRole("button", { name: "passport:overrides.save" }));

    expect(within(d).getByText("passport:overrides.countryRequired")).toBeInTheDocument();
    expect(within(d).getByText("passport:overrides.noteRequired")).toBeInTheDocument();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("corrects an automatic row with the dialog prefilled, and marks it 'corrected'", async () => {
    const corrected = country({
      kinds: ["flight", "manual"],
      override: { verdict: "visited", note: "was there a week", day: null },
    });
    getPassportMock
      .mockResolvedValueOnce(passport([corrected]))
      .mockResolvedValueOnce(passport([{ ...corrected, counted: false }]));
    saveMock.mockResolvedValue({});
    const user = userEvent.setup();
    renderPage();

    const row = (await screen.findByText("Germany")).closest("tr")!;
    expect(within(row).getByTestId("override-label")).toHaveTextContent(
      "passport:overrides.labelCorrected"
    );
    await user.click(within(row).getByRole("button", { name: "passport:overrides.correct" }));
    const d = await dialog();
    expect(within(d).queryByLabelText("passport:overrides.country")).toBeNull();
    expect(within(d).getByLabelText("passport:overrides.note")).toHaveValue("was there a week");
    await user.click(within(d).getByRole("radio", { name: /passport:overrides.verdict.ground/ }));
    await user.click(within(d).getByRole("button", { name: "passport:overrides.save" }));

    await waitFor(() =>
      expect(saveMock).toHaveBeenCalledWith("DE", {
        verdict: "ground",
        note: "was there a week",
        day: null,
      })
    );
    await waitFor(() => expect(getPassportMock).toHaveBeenCalledTimes(2));
  });

  it("deletes a correction from the same dialog", async () => {
    getPassportMock
      .mockResolvedValueOnce(passport([MANUAL_PT]))
      .mockResolvedValueOnce(passport([]));
    removeMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();

    const row = (await screen.findByText("Portugal")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "passport:overrides.correct" }));
    await user.click(
      within(await dialog()).getByRole("button", { name: "passport:overrides.delete" })
    );

    await waitFor(() => expect(removeMock).toHaveBeenCalledWith("PT"));
    await waitFor(() => expect(screen.queryByTestId("country-override-dialog")).toBeNull());
    expect(getPassportMock).toHaveBeenCalledTimes(2);
  });

  it("offers no delete for a row that has no correction yet", async () => {
    getPassportMock.mockResolvedValue(passport([country({})]));
    const user = userEvent.setup();
    renderPage();

    const row = (await screen.findByText("Germany")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "passport:overrides.correct" }));
    expect(
      within(await dialog()).queryByRole("button", { name: "passport:overrides.delete" })
    ).toBeNull();
  });

  it.each([
    [
      "an unknown country",
      { response: { data: { code: "COUNTRY_UNKNOWN" } } },
      "passport:overrides.unknownCountry",
    ],
    [
      "the demo account",
      { response: { data: { error: "DEMO_ACCOUNT_FORBIDDEN" } } },
      "passport:overrides.demoForbidden",
    ],
    ["any other failure", new Error("Network Error"), "passport:overrides.saveError"],
  ])("says a failed save for %s as itself and keeps the dialog open", async (_l, err, key) => {
    getPassportMock.mockResolvedValue(passport([country({})]));
    saveMock.mockRejectedValue(err);
    const user = userEvent.setup();
    renderPage();

    const row = (await screen.findByText("Germany")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "passport:overrides.correct" }));
    const d = await dialog();
    await user.type(within(d).getByLabelText("passport:overrides.note"), "why");
    await user.click(within(d).getByRole("button", { name: "passport:overrides.save" }));

    expect(await within(d).findByRole("alert")).toHaveTextContent(key);
    expect(screen.getByTestId("country-override-dialog")).toBeInTheDocument();
    expect(getPassportMock).toHaveBeenCalledTimes(1);
  });

  it("says so when the saved correction cannot be reloaded", async () => {
    getPassportMock
      .mockResolvedValueOnce(passport([country({})]))
      .mockRejectedValueOnce(new Error("Network Error"));
    saveMock.mockResolvedValue({});
    const user = userEvent.setup();
    renderPage();

    const row = (await screen.findByText("Germany")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "passport:overrides.correct" }));
    const d = await dialog();
    await user.type(within(d).getByLabelText("passport:overrides.note"), "why");
    await user.click(within(d).getByRole("button", { name: "passport:overrides.save" }));

    expect(await within(d).findByRole("alert")).toHaveTextContent("passport:overrides.reloadError");
  });

  it("says so when the country list for adding cannot be loaded", async () => {
    getPassportMock.mockResolvedValue(passport([country({})]));
    listMock.mockRejectedValue(new Error("Network Error"));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "passport:overrides.add" }));
    expect(await within(await dialog()).findByRole("alert")).toHaveTextContent(
      "passport:overrides.loadError"
    );
  });

  it("shows the note in the country's provenance", async () => {
    getPassportMock.mockResolvedValue(passport([MANUAL_PT]));
    getCountryDetailMock.mockRejectedValue({ response: { status: 404 } });
    const user = userEvent.setup();
    renderPage();

    const row = (await screen.findByText("Portugal")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "passport:countries.showRecords" }));
    const note = await screen.findByTestId("provenance-override");
    expect(note).toHaveTextContent("passport:overrides.verdict.visited");
    expect(note).toHaveTextContent("passport:overrides.provenanceNote");
  });

  it("lists excluded countries apart and counts one again on request", async () => {
    getPassportMock
      .mockResolvedValueOnce(
        passport([country({})], {
          excludedCountries: [{ code: "FR", note: "hotel geocoded wrongly", day: null }],
        })
      )
      .mockResolvedValueOnce(passport([country({})]));
    removeMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();

    const section = await screen.findByRole("region", { name: "passport:overrides.excludedTitle" });
    expect(within(section).getByText("France")).toBeInTheDocument();
    await user.click(within(section).getByRole("button", { name: "passport:overrides.restore" }));

    await waitFor(() => expect(removeMock).toHaveBeenCalledWith("FR"));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "passport:overrides.excludedTitle" })).toBeNull()
    );
  });

  it("says a failed restore as itself", async () => {
    getPassportMock.mockResolvedValue(
      passport([country({})], {
        excludedCountries: [{ code: "FR", note: "x", day: null }],
      })
    );
    removeMock.mockRejectedValue(new Error("Network Error"));
    const user = userEvent.setup();
    renderPage();

    const section = await screen.findByRole("region", { name: "passport:overrides.excludedTitle" });
    await user.click(within(section).getByRole("button", { name: "passport:overrides.restore" }));
    expect(await within(section).findByRole("alert")).toHaveTextContent(
      "passport:overrides.restoreError"
    );
  });
});
