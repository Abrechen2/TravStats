import { describe, expect, it, vi } from "vitest";
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
    render(<ServiceAccordion groups={groups} initiallyOpen="flight" />);
    const row = (id: string) => group("flight").querySelector(`[data-service="${id}"]`)!;
    expect(row("aviationstack")).toHaveTextContent("settings:services.badge.admin");
    expect(row("opensky")).toHaveTextContent("settings:services.badge.own");
    expect(row("airlabs")).toHaveTextContent("settings:services.badge.own");
    expect(row("aerodatabox")).toHaveTextContent("settings:services.badge.none");
    expect(row("aeroapi")).not.toHaveTextContent("settings:services.badge");
  });

  it("says so when an own key overrides the instance's, and only then", () => {
    render(<ServiceAccordion groups={groups} initiallyOpen="flight" />);
    const notes = group("flight").querySelectorAll("[data-own-overrides]");
    expect(notes).toHaveLength(1);
    expect(notes[0].closest("[data-service]")).toHaveAttribute("data-service", "airlabs");
  });

  it("opens and closes a group, keeping its cards mounted while closed", () => {
    render(<ServiceAccordion groups={groups} />);
    const header = within(group("flight")).getAllByRole("button")[0];
    expect(header).toHaveAttribute("aria-expanded", "false");
    // Mounted but hidden: the cards load their own state and report it up.
    expect(screen.getByText("airlabs-card")).not.toBeVisible();
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    // The card folds behind its row's action until asked for.
    expect(screen.getByText("airlabs-card")).not.toBeVisible();
    fireEvent.click(
      within(group("flight")).getByRole("button", { name: "settings:services.action.edit" })
    );
    expect(screen.getByText("airlabs-card")).toBeVisible();
  });

  // forgejo#321 prototype: one group open at a time per surface.
  it("keeps one group open at a time", () => {
    render(<ServiceAccordion groups={groups} initiallyOpen="flight" />);
    const header = (id: string) => within(group(id)).getAllByRole("button")[0];
    expect(header("flight")).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(header("cross"));
    expect(header("cross")).toHaveAttribute("aria-expanded", "true");
    expect(header("flight")).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(header("cross"));
    expect(header("cross")).toHaveAttribute("aria-expanded", "false");
  });

  it("says how many services a group holds, and what the badges mean, once", () => {
    render(<ServiceAccordion groups={groups} />);
    expect(group("flight").querySelector("[data-service-count]")).toHaveTextContent(
      "settings:services.count"
    );
    expect(document.querySelectorAll("[data-service-legend]")).toHaveLength(1);
    expect(document.querySelector('[data-service-legend="personal"]')).toHaveTextContent(
      "settings:services.legend.admin"
    );
  });

  it("names the same action for the same badge on every row", () => {
    render(<ServiceAccordion groups={groups} initiallyOpen="flight" />);
    const action = (id: string) =>
      group("flight").querySelector(`[data-service="${id}"] [data-service-action]`);
    // aviationstack/aerodatabox/opensky have no form here: no action without one.
    expect(action("aviationstack")).toBeNull();
    expect(action("airlabs")).toHaveTextContent("settings:services.action.edit");
    expect(action("aeroapi")).toBeNull();
  });

  it("calls a row's own action when its settings live elsewhere", () => {
    const onAction = vi.fn();
    const withActions: ServiceGroup[] = [
      {
        id: "g",
        label: "G",
        items: [
          { id: "a", name: "A", state: "admin", onAction },
          { id: "o", name: "O", state: "own", onAction },
          { id: "n", name: "N", state: "none", onAction },
        ],
      },
    ];
    render(<ServiceAccordion groups={withActions} initiallyOpen="g" />);
    const label = (id: string) =>
      document.querySelector(`[data-service="${id}"] [data-service-action]`)?.textContent;
    expect(label("a")).toBe("settings:services.action.useOwn");
    expect(label("o")).toBe("settings:services.action.edit");
    expect(label("n")).toBe("settings:services.action.setUp");
    fireEvent.click(screen.getByRole("button", { name: "settings:services.action.useOwn" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("says 'Bearbeiten' for a key the admin set, on the admin surface", () => {
    render(
      <ServiceAccordion
        surface="admin"
        initiallyOpen="g"
        groups={[
          { id: "g", label: "G", items: [{ id: "a", name: "A", state: "admin", onAction() {} }] },
        ]}
      />
    );
    expect(document.querySelector("[data-service-action]")).toHaveTextContent(
      "settings:services.action.edit"
    );
    expect(document.querySelector('[data-service="a"]')).toHaveTextContent(
      "settings:services.badge.setUp"
    );
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
    [{ hasKey: false, isShared: false, hasAccess: false }, "none"],
    // A key from the server's environment: working for everyone, but neither
    // the account's own nor stored by the admin (codex final review).
    [{ hasKey: false, isShared: false, hasAccess: true }, "admin"],
    [undefined, null],
  ])("reads %j as %s", (status, state) => {
    expect(keyState(status)).toBe(state);
  });
});
