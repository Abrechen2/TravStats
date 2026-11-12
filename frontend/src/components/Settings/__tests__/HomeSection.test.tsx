import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
// The residence and its moves are HomeAirportSection's own tests.
vi.mock("../HomeAirportSection", () => ({ default: () => <div data-testid="residence" /> }));

const get = vi.fn();
const update = vi.fn();
vi.mock("@/lib/api/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/settings")>();
  return {
    ...actual,
    settingsApi: {
      ...actual.settingsApi,
      get: (...args: unknown[]) => get(...args),
      update: (...args: unknown[]) => update(...args),
    },
  };
});
const getFacts = vi.fn();
const putFacts = vi.fn();
vi.mock("../../../lib/api/companionData", () => ({
  personalApi: { get: () => getFacts(), put: (p: unknown) => putFacts(p) },
}));

import { resetWriteQueue } from "../../ui/settings/writeQueue";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";
import HomeSection from "../HomeSection";

const settle = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const country = (): HTMLSelectElement =>
  screen.getByLabelText("settings:home.country.name") as HTMLSelectElement;

/** Heimatland under Heimatort: the one fact beside the residence, an expert row. */
describe("HomeSection facts", () => {
  beforeEach(() => {
    useSettingsLevelStore.setState({ level: "expert" });
    get.mockReset().mockResolvedValue({ homeCountry: "ES" });
    update.mockReset().mockResolvedValue({});
    getFacts.mockReset().mockResolvedValue({ homePlace: null, passportExpiry: "2030-05-01" });
    putFacts.mockReset();
  });
  afterEach(() => {
    cleanup();
    act(() => resetWriteQueue());
    vi.useRealTimers();
  });

  it("shows the stored home country (expert) and no passport row, which moved to Profil", async () => {
    render(<HomeSection />);
    await waitFor(() => expect(country().value).toBe("ES"));
    expect(screen.queryByLabelText("settings:home.passport.name")).toBeNull();
    expect(within(country()).getByText("Deutschland").tagName).toBe("OPTION");
  });

  it("saves the chosen country as its ISO code, and clearing sends null", async () => {
    render(<HomeSection />);
    await waitFor(() => expect(country().value).toBe("ES"));
    vi.useFakeTimers();
    fireEvent.change(country(), { target: { value: "DE" } });
    await settle(400);
    expect(update).toHaveBeenCalledWith({ homeCountry: "DE" });
    fireEvent.change(country(), { target: { value: "" } });
    await settle(400);
    expect(update).toHaveBeenLastCalledWith({ homeCountry: null });
  });

  it("a refused country save keeps the pick, says it was not saved and Verwerfen brings the saved one back", async () => {
    update.mockRejectedValue(new Error("offline"));
    render(<HomeSection />);
    await waitFor(() => expect(country().value).toBe("ES"));
    vi.useFakeTimers();
    fireEvent.change(country(), { target: { value: "FR" } });
    await settle(400);
    expect(country().value).toBe("FR");
    expect(screen.getByRole("alert")).toHaveTextContent("settings:blocks.save.failed");
    fireEvent.click(screen.getByRole("button", { name: "settings:blocks.save.discard" }));
    expect(country().value).toBe("ES");
  });

  it("hides the home country at the standard level and reports it as one hidden setting", async () => {
    useSettingsLevelStore.setState({ level: "standard" });
    render(<HomeSection />);
    await act(async () => {});
    expect(screen.queryByLabelText("settings:home.country.name")).toBeNull();
  });

  it("a failed load locks the country row instead of showing an empty choice as the truth", async () => {
    get.mockRejectedValue(new Error("offline"));
    render(<HomeSection />);
    expect(await screen.findAllByText("settings:home.loadFailed")).not.toHaveLength(0);
    expect(country().disabled).toBe(true);
  });
});
