import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

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

import HomeCountryCard from "../HomeCountryCard";
import { useToastStore } from "../../../store/toastStore";

/**
 * Plan 2026-10-09 P5: the home country orders booking templates. The select
 * shows the stored value, saves a choice as an ISO code, clears with null, and
 * puts the old value back (with a toast) when the write fails.
 */
describe("HomeCountryCard", () => {
  beforeEach(() => {
    get.mockReset();
    update.mockReset();
  });

  const select = (): HTMLSelectElement =>
    screen.getByLabelText("settings:homeCountry.label") as HTMLSelectElement;

  it("shows the stored home country and the help text", async () => {
    get.mockResolvedValue({ homeCountry: "ES" });
    render(<HomeCountryCard />);
    await waitFor(() => expect(select().value).toBe("ES"));
    expect(screen.getByText("settings:homeCountry.description")).toBeTruthy();
    // Every country is offered, by its localised name.
    expect(screen.getByRole("option", { name: "Deutschland" })).toBeTruthy();
  });

  it("saves the chosen country as its ISO code", async () => {
    get.mockResolvedValue({ homeCountry: null });
    update.mockResolvedValue({});
    const user = userEvent.setup();
    render(<HomeCountryCard />);
    await waitFor(() => expect(get).toHaveBeenCalled());

    await user.selectOptions(select(), "DE");

    expect(update).toHaveBeenCalledWith({ homeCountry: "DE" });
    expect(select().value).toBe("DE");
  });

  it("clearing the choice sends null", async () => {
    get.mockResolvedValue({ homeCountry: "DE" });
    update.mockResolvedValue({});
    const user = userEvent.setup();
    render(<HomeCountryCard />);
    await waitFor(() => expect(select().value).toBe("DE"));

    await user.selectOptions(select(), "");

    expect(update).toHaveBeenCalledWith({ homeCountry: null });
  });

  it("a failed save puts the previous value back and says so", async () => {
    get.mockResolvedValue({ homeCountry: "DE" });
    update.mockRejectedValue(new Error("offline"));
    const addToast = vi.spyOn(useToastStore.getState(), "addToast");
    const user = userEvent.setup();
    render(<HomeCountryCard />);
    await waitFor(() => expect(select().value).toBe("DE"));

    await user.selectOptions(select(), "FR");

    await waitFor(() => expect(select().value).toBe("DE"));
    expect(addToast).toHaveBeenCalledWith("error", "settings:errors.saveFailed");
  });

  it("a failed load says so instead of showing an empty choice as the truth", async () => {
    get.mockRejectedValue(new Error("offline"));
    render(<HomeCountryCard />);
    expect(await screen.findByText("settings:homeCountry.loadFailed")).toBeTruthy();
    expect(select().disabled).toBe(true);
  });
});
