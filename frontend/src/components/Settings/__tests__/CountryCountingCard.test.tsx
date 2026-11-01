import { beforeEach, describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const getPassport = vi.fn();
vi.mock("../../../lib/api/stats", () => ({ statsApi: { getPassport: () => getPassport() } }));

import CountryCountingCard from "../CountryCountingCard";

const renderCard = async (): Promise<void> => {
  render(
    <MemoryRouter>
      <CountryCountingCard />
    </MemoryRouter>
  );
  await act(async () => {});
};

describe("CountryCountingCard", () => {
  beforeEach(() => getPassport.mockReset());

  it("shows both sets as the server counts them, and offers no dial that changes nothing", async () => {
    getPassport.mockResolvedValue({
      summary: { countries: 31, visitedCountries: 31, groundCountries: 44, countriesTotal: 44 },
    });
    await renderCard();
    expect(screen.getByText("31")).toBeTruthy();
    expect(screen.getByText("44")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("says the numbers could not be read, with a retry, instead of showing zero", async () => {
    getPassport.mockRejectedValueOnce(new Error("503"));
    getPassport.mockResolvedValueOnce({ summary: { countries: 5, countriesTotal: 9 } });
    await renderCard();
    expect(screen.getByText("settings:countryCounting.loadFailed")).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "settings:blocks.save.retry" }));
    });
    expect(screen.queryByText("settings:countryCounting.loadFailed")).toBeNull();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("9")).toBeTruthy();
  });
});
