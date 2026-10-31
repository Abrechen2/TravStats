import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

const getFacts = vi.fn();
const putFacts = vi.fn();
vi.mock("../../../lib/api/companionData", () => ({
  personalApi: { get: () => getFacts(), put: (p: unknown) => putFacts(p) },
}));
const search = vi.fn();
vi.mock("../../../lib/api/geo", () => ({
  searchPlaces: (...a: unknown[]) => search(...a),
}));
const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: { getState: () => ({ addToast }) },
}));

import PersonalFactsCard from "../PersonalFactsCard";

const HOME = { name: "Hamburg, Deutschland", lat: 53.55, lon: 10, zone: null };

describe("PersonalFactsCard (home place, passport expiry)", () => {
  beforeEach(() => {
    getFacts.mockReset().mockResolvedValue({ homePlace: HOME, passportExpiry: "2030-05-01" });
    putFacts.mockReset();
    search.mockReset();
    addToast.mockReset();
  });

  it("shows what the Companion wrote", async () => {
    render(<PersonalFactsCard />);
    expect(await screen.findByText("Hamburg, Deutschland")).toBeTruthy();
    expect(
      (screen.getByLabelText("settings:personalFacts.passport.label") as HTMLInputElement).value
    ).toBe("2030-05-01");
  });

  it("saves a changed passport expiry and shows the server's answer", async () => {
    putFacts.mockResolvedValue({ homePlace: HOME, passportExpiry: "2031-01-02" });
    render(<PersonalFactsCard />);
    await screen.findByText("Hamburg, Deutschland");
    const input = screen.getByLabelText(
      "settings:personalFacts.passport.label"
    ) as HTMLInputElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    await userEvent.clear(input);
    await userEvent.type(input, "2031-01-02");
    await userEvent.tab();
    await waitFor(() => expect(putFacts).toHaveBeenCalledWith({ passportExpiry: "2031-01-02" }));
  });

  it("tells the user when saving the passport expiry fails and keeps the stored day", async () => {
    putFacts.mockRejectedValue(new Error("500"));
    render(<PersonalFactsCard />);
    await screen.findByText("Hamburg, Deutschland");
    const input = screen.getByLabelText(
      "settings:personalFacts.passport.label"
    ) as HTMLInputElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    await userEvent.clear(input);
    await userEvent.type(input, "2031-01-02");
    await userEvent.tab();
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "settings:errors.saveFailed")
    );
    expect(input.value).toBe("2030-05-01");
  });

  it("says the place service is unreachable instead of 'no match' on a degraded search", async () => {
    search.mockResolvedValue({ results: [], degraded: true });
    render(<PersonalFactsCard />);
    await userEvent.type(
      await screen.findByLabelText("settings:personalFacts.homePlace.search"),
      "Lissabon"
    );
    await userEvent.click(screen.getByText("settings:personalFacts.homePlace.searchAction"));
    expect(await screen.findByText("settings:personalFacts.homePlace.searchDegraded")).toBeTruthy();
    expect(screen.queryByText("settings:personalFacts.homePlace.noResults")).toBeNull();
  });

  it("sets the home place from a search hit", async () => {
    search.mockResolvedValue({
      results: [{ name: "Lissabon", city: "Lissabon", country: "Portugal", lat: 38.7, lon: -9.1 }],
      degraded: false,
    });
    putFacts.mockResolvedValue({
      homePlace: { name: "Lissabon, Portugal", lat: 38.7, lon: -9.1, zone: null },
      passportExpiry: "2030-05-01",
    });
    render(<PersonalFactsCard />);
    await userEvent.type(
      await screen.findByLabelText("settings:personalFacts.homePlace.search"),
      "Lissabon"
    );
    await userEvent.click(screen.getByText("settings:personalFacts.homePlace.searchAction"));
    await userEvent.click(await screen.findByText("Lissabon, Portugal"));
    await waitFor(() =>
      expect(putFacts).toHaveBeenCalledWith({
        homePlace: { name: "Lissabon, Portugal", lat: 38.7, lon: -9.1, zone: null },
      })
    );
  });

  it("says the details could not be loaded instead of showing 'not set'", async () => {
    getFacts.mockRejectedValue(new Error("offline"));
    render(<PersonalFactsCard />);
    expect(await screen.findByText("settings:personalFacts.loadFailed")).toBeTruthy();
    expect(screen.queryByText("settings:personalFacts.notSet")).toBeNull();
  });
});
