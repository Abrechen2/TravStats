import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));
vi.mock("react-map-gl/maplibre", () => ({ default: () => <div /> }));
vi.mock("../../map/DeckGLOverlay", () => ({ DeckGLOverlay: () => null }));
vi.mock("../../map/SharedMapOverlays", () => ({ SharedMapOverlays: () => null }));
vi.mock("../../map/useBasemapStyle", () => ({ useBasemapStyle: () => ({}) }));
vi.mock("../../../hooks/useDomainColors", () => ({
  useDomainColors: () => ({ colorOf: () => "#336699" }),
}));
const admin = { current: false };
vi.mock("../../../store/authStore", () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { isAdmin: admin.current } }),
}));

import { RailRouteMap } from "../RailRouteMap";
import type { RailJourney } from "../../../types/rail";

const journey = (extra: Partial<RailJourney>) =>
  ({
    id: "j1",
    depLat: 52.5,
    depLon: 13.4,
    arrLat: 50.1,
    arrLon: 8.7,
    geometry: null,
    geometrySource: "straight",
    ...extra,
  }) as RailJourney;

const view = (j: RailJourney) =>
  render(
    <MemoryRouter>
      <RailRouteMap journey={j} />
    </MemoryRouter>
  );

describe("RailRouteMap: a straight line says when the missing router is the reason", () => {
  it("names the missing router and links admins to the setting", () => {
    admin.current = true;
    view(journey({ geometryReason: "noRouter" }));
    expect(screen.getByTestId("rail-line-source").textContent).toContain(
      "rail:detail.lineNoRouter"
    );
    expect(screen.getByTestId("rail-no-router-setup").getAttribute("href")).toBe(
      "/settings/dienstek?service=selfHostedRouting"
    );
  });

  it("tells everyone else who can set it up, without a link", () => {
    admin.current = false;
    view(journey({ geometryReason: "noRouter" }));
    expect(screen.getByTestId("rail-line-source").textContent).toContain(
      "rail:detail.lineNoRouterAskAdmin"
    );
    expect(screen.queryByTestId("rail-no-router-setup")).toBeNull();
  });

  it("keeps the plain straight-line text when no router is not the reason", () => {
    admin.current = true;
    view(journey({ geometryReason: null }));
    expect(screen.getByTestId("rail-line-source").textContent).toBe("rail:detail.lineStraight");
  });
});
