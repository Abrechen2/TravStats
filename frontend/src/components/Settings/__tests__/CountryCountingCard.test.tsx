import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    // Interpolation is part of what this card promises — the fallback option
    // has to NAME the instance default — so the stub renders it rather than
    // dropping it, and the key stays readable as the assertion target.
    t: (k: string, vars?: Record<string, unknown>) =>
      vars && "tier" in vars ? `${k}:${String(vars.tier)}` : k,
  }),
}));

const update = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../lib/api", () => ({ settingsApi: { update: (...a: unknown[]) => update(...a) } }));

vi.unmock("../../../store/settingsStore");

import CountryCountingCard from "../CountryCountingCard";
import { useSettingsStore } from "../../../store/settingsStore";

/**
 * The per-user override — spec §3.2, and §5 on saying what changes.
 *
 * Two of these pin copy rather than behaviour, deliberately. This control moves
 * a number the user has already seen, and "a number that changes without
 * explanation reads as data loss" — so the effect sentence and the promise that
 * the LIST does not move are part of the feature, not decoration around it.
 */
describe("CountryCountingCard", () => {
  beforeEach(() => {
    update.mockClear();
    useSettingsStore.setState({
      countryThreshold: null,
      instanceCountryThreshold: "visited",
      // Most accounts. The two cases that differ set it themselves.
      hasCountryTracks: null,
    });
  });

  it("offers the instance default as a value, and names it", () => {
    useSettingsStore.setState({ instanceCountryThreshold: "slept" });
    render(<CountryCountingCard />);

    // Not choosing is a real state that keeps tracking the admin, so it is an
    // option rather than an untouched control — and it says which tier that is,
    // read from the server rather than guessed.
    expect(
      screen.getByRole("radio", {
        name: "settings:countryCounting.useInstanceDefault:passport:thresholdChoice.options.slept",
      })
    ).toBeTruthy();
  });

  it("shows the effect of the tier currently in force, not of the user's own field", () => {
    // No choice of their own: what applies is the instance's, so that is the
    // sentence the user must read.
    useSettingsStore.setState({ countryThreshold: null, instanceCountryThreshold: "connection" });
    render(<CountryCountingCard />);

    expect(screen.getByText("passport:thresholdChoice.effect.connection")).toBeTruthy();
  });

  it("always states that the country list does not move", () => {
    render(<CountryCountingCard />);
    expect(screen.getByText("passport:thresholdChoice.listUnchanged")).toBeTruthy();
  });

  it("persists a chosen tier immediately", async () => {
    const user = userEvent.setup();
    render(<CountryCountingCard />);

    await user.click(screen.getByRole("radio", { name: "passport:thresholdChoice.options.slept" }));

    expect(useSettingsStore.getState().countryThreshold).toBe("slept");
    expect(update).toHaveBeenCalledWith({ countryThreshold: "slept" });
  });

  it("sends an explicit null when the user goes back to the instance default", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ countryThreshold: "slept" });
    render(<CountryCountingCard />);

    await user.click(screen.getByRole("radio", { name: /useInstanceDefault/ }));

    // Omitting the key would mean "leave my choice alone"; this has to mean
    // "I no longer have one".
    expect(useSettingsStore.getState().countryThreshold).toBeNull();
    expect(update).toHaveBeenCalledWith({ countryThreshold: null });
  });

  /** Every choice currently offered, in order, as its tier ("__instance__" first). */
  const optionValues = (): string[] =>
    screen
      .getAllByRole("radio")
      .map((r) => r.getAttribute("aria-label") ?? "")
      .map((name) =>
        /useInstanceDefault/.test(name) ? "__instance__" : name.replace(/^.*options\./, "")
      );

  it("offers the tiers lowest bar first, and no hours-based option", () => {
    useSettingsStore.setState({ hasCountryTracks: true });
    render(<CountryCountingCard />);

    // §2 refuses duration thresholds on principle: six hours and twelve hours
    // returned the same set of countries, so a dial would promise precision the
    // data does not hold.
    expect(optionValues()).toEqual(["__instance__", "connection", "transited", "visited", "slept"]);
  });

  it("withholds `transited` from an account with no location history", () => {
    // §3.4c: a road crossing is observable only through a location history, so
    // on an account without one this option would produce exactly the same
    // number as `visited`. A control with two settings that do the same thing
    // does not read as an empty set — it reads as broken.
    useSettingsStore.setState({ hasCountryTracks: null, countryThreshold: null });
    render(<CountryCountingCard />);

    expect(optionValues()).toEqual(["__instance__", "connection", "visited", "slept"]);
  });

  it("still shows `transited` to somebody who already chose it", () => {
    // A choice whose current value is not drawn shows nothing selected. Their choice stays theirs to see and to change,
    // whatever the sweep has found so far.
    useSettingsStore.setState({ hasCountryTracks: false, countryThreshold: "transited" });
    render(<CountryCountingCard />);

    expect(optionValues()).toContain("transited");
    expect(
      screen.getByRole("radio", { name: "passport:thresholdChoice.options.transited" })
    ).toHaveAttribute("aria-checked", "true");
  });
});
