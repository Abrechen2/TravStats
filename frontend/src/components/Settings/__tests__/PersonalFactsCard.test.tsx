import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

const getFacts = vi.fn();
const putFacts = vi.fn();
vi.mock("../../../lib/api/companionData", () => ({
  personalApi: { get: () => getFacts(), put: (p: unknown) => putFacts(p) },
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
    addToast.mockReset();
  });

  it("shows what the Companion wrote", async () => {
    render(
      <MemoryRouter>
        <PersonalFactsCard />
      </MemoryRouter>
    );
    expect(await screen.findByText("Hamburg, Deutschland")).toBeTruthy();
    expect(
      (screen.getByLabelText("settings:personalFacts.passport.label") as HTMLInputElement).value
    ).toBe("2030-05-01");
  });

  it("offers no home place editor: it shows the residence and links to the home periods", async () => {
    getFacts.mockResolvedValue({
      homePlace: HOME,
      homePlaceSource: "period",
      passportExpiry: null,
    });
    render(
      <MemoryRouter>
        <PersonalFactsCard />
      </MemoryRouter>
    );
    expect(await screen.findByText("Hamburg, Deutschland")).toBeTruthy();
    expect(screen.queryByLabelText("settings:personalFacts.homePlace.search")).toBeNull();
    expect(screen.getByTestId("home-place-edit-link").getAttribute("href")).toBe(
      "/settings/flight?section=homeAirport"
    );
  });

  it("saves a changed passport expiry and shows the server's answer", async () => {
    putFacts.mockResolvedValue({ homePlace: HOME, passportExpiry: "2031-01-02" });
    render(
      <MemoryRouter>
        <PersonalFactsCard />
      </MemoryRouter>
    );
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
    render(
      <MemoryRouter>
        <PersonalFactsCard />
      </MemoryRouter>
    );
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

  it("says the details could not be loaded instead of showing 'not set'", async () => {
    getFacts.mockRejectedValue(new Error("offline"));
    render(
      <MemoryRouter>
        <PersonalFactsCard />
      </MemoryRouter>
    );
    expect(await screen.findByText("settings:personalFacts.loadFailed")).toBeTruthy();
    expect(screen.queryByText("settings:personalFacts.notSet")).toBeNull();
  });

  it("does not clear the stored passport expiry when the date field is left half-typed", async () => {
    render(
      <MemoryRouter>
        <PersonalFactsCard />
      </MemoryRouter>
    );
    await screen.findByText("Hamburg, Deutschland");
    const input = screen.getByLabelText(
      "settings:personalFacts.passport.label"
    ) as HTMLInputElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    Object.defineProperty(input, "validity", { value: { badInput: true } });
    input.value = "";
    input.focus();
    input.blur();
    await new Promise((r) => setTimeout(r, 20));
    expect(putFacts).not.toHaveBeenCalled();
  });
});
