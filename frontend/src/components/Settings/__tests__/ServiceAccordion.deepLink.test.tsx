import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { ServiceAccordion, type ServiceGroup } from "../ServiceAccordion";

/**
 * beta.22 UAT: the settings search hit "OpenRouteService" opened Dienste at
 * the expert level, but the Straßenrouting group stayed collapsed and nothing
 * scrolled to it — the link named a setting the page then hid. A link that
 * names a service (`&match=`) opens its group and scrolls to the service.
 */
const groups: ServiceGroup[] = [
  {
    id: "cross",
    label: "Bereichsübergreifend",
    items: [{ id: "immich", name: "Immich", state: null }],
  },
  {
    id: "routing",
    label: "Straßenrouting",
    items: [
      { id: "openrouteservice", name: "OpenRouteService", state: "none" },
      { id: "graphhopper", name: "GraphHopper", state: "none" },
    ],
  },
];

const panelOf = (id: string): HTMLElement => {
  const button = document.querySelector(
    `[data-service-group="${id}"] button[aria-expanded]`
  ) as HTMLElement;
  return document.getElementById(button.getAttribute("aria-controls")!) as HTMLElement;
};

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.useRealTimers();
});

describe("ServiceAccordion deep link", () => {
  it("opens the group of the named service and scrolls the service into view", () => {
    vi.useFakeTimers();
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.getAttribute("data-service") ?? "");
    };
    window.history.replaceState(
      null,
      "",
      "/settings/services?section=externalServices&match=OpenRouteService-Schl%C3%BCssel&expert=1"
    );
    render(<ServiceAccordion groups={groups} initiallyOpen={["cross"]} />);
    expect(panelOf("routing").hidden).toBe(false);
    expect(panelOf("cross").hidden).toBe(false);
    act(() => {
      vi.runAllTimers();
    });
    expect(scrolled).toContain("openrouteservice");
  });

  it("leaves the groups as they are without a named service", () => {
    window.history.replaceState(null, "", "/settings/services?section=externalServices");
    render(<ServiceAccordion groups={groups} initiallyOpen={["cross"]} />);
    expect(panelOf("routing").hidden).toBe(true);
  });
});
