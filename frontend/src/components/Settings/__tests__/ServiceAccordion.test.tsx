import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ServiceAccordion, summarise, type ServiceGroup } from "../ServiceAccordion";
import { keyState } from "../ServicesSection";

/**
 * forgejo#321 (tester, Discord 2026-10-18): services grouped by domain as
 * accordions, a header that says what is already running, and a badge per
 * service saying who provides it. `t` echoes keys in tests, with its options
 * appended by nobody — so the summary is read off `data-service-summary`'s
 * interpolation through `summarise`, and the badges by their keys.
 */
const groups: ServiceGroup[] = [
  {
    id: "flight",
    label: "Flug",
    items: [
      { id: "airlabs", name: "AirLabs", state: "adminOwn", body: <p>airlabs-card</p> },
      { id: "aviationstack", name: "Aviationstack", state: "admin" },
      { id: "aerodatabox", name: "AeroDataBox", state: "none" },
      { id: "opensky", name: "OpenSky", state: "own" },
      { id: "aeroapi", name: "AeroAPI", state: null },
    ],
  },
  {
    id: "cross",
    label: "Bereichsübergreifend",
    items: [{ id: "immich", name: "Immich", state: "admin" }],
  },
  { id: "empty", label: "Leer", items: [] },
];

const group = (id: string): HTMLElement =>
  document.querySelector(`[data-service-group="${id}"]`) as HTMLElement;

describe("ServiceAccordion", () => {
  it("counts services active for everyone and the account's own in the header", () => {
    expect(summarise(groups[0].items)).toEqual({ shared: 2, own: 2 });
    expect(summarise(groups[1].items)).toEqual({ shared: 1, own: 0 });
  });

  it("badges each service by who provides it, and none while it is unknown", () => {
    render(<ServiceAccordion groups={groups} initiallyOpen={["flight"]} />);
    const row = (id: string) => group("flight").querySelector(`[data-service="${id}"]`)!;
    expect(row("aviationstack")).toHaveTextContent("settings:services.badge.admin");
    expect(row("opensky")).toHaveTextContent("settings:services.badge.own");
    expect(row("airlabs")).toHaveTextContent("settings:services.badge.own");
    expect(row("aerodatabox")).toHaveTextContent("settings:services.badge.none");
    expect(row("aeroapi")).not.toHaveTextContent("settings:services.badge");
  });

  it("says so when an own key overrides the instance's, and only then", () => {
    render(<ServiceAccordion groups={groups} initiallyOpen={["flight"]} />);
    const notes = group("flight").querySelectorAll("[data-own-overrides]");
    expect(notes).toHaveLength(1);
    expect(notes[0].closest("[data-service]")).toHaveAttribute("data-service", "airlabs");
  });

  it("opens and closes a group, keeping its cards mounted while closed", () => {
    render(<ServiceAccordion groups={groups} />);
    const header = within(group("flight")).getByRole("button");
    expect(header).toHaveAttribute("aria-expanded", "false");
    // Mounted but hidden: the cards load their own state and report it up.
    expect(screen.getByText("airlabs-card")).not.toBeVisible();
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("airlabs-card")).toBeVisible();
  });

  it("draws no group for a domain without services", () => {
    render(<ServiceAccordion groups={groups} />);
    expect(group("empty")).toBeNull();
  });
});

describe("keyState", () => {
  it.each([
    [{ hasKey: true, isShared: true }, "adminOwn"],
    [{ hasKey: true, isShared: false }, "own"],
    [{ hasKey: false, isShared: true }, "admin"],
    [{ hasKey: false, isShared: false }, "none"],
    [undefined, null],
  ])("reads %j as %s", (status, state) => {
    expect(keyState(status)).toBe(state);
  });
});
