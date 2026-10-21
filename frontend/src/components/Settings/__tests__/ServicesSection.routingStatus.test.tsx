import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const api = vi.hoisted(() => ({
  getApiKeys: vi.fn(),
  updateApiKeys: vi.fn(),
  testApiKey: vi.fn(),
}));
vi.mock("../../../lib/api", () => ({
  settingsApi: api,
  adminApi: { testApiKey: vi.fn() },
}));
vi.mock("../../../lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../../../hooks/useToursVisible", () => ({ useToursVisible: () => true }));
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ isEnabled: () => false }),
}));
vi.mock("../../../hooks/useDomainColors", () => ({
  useDomainColors: () => ({ colorOf: () => "#000" }),
}));
vi.mock("../frame/useExpertRows", () => ({ useExpertRows: () => true }));
vi.mock("../ImmichConnectionCard", () => ({ default: () => null }));
vi.mock("../PhotoJourneyNightlyScanCard", () => ({ default: () => null }));
vi.mock("../StravaConnectionCard", () => ({ default: () => null }));
vi.mock("../OpenDataCard", () => ({ default: () => null }));

import { MemoryRouter } from "react-router-dom";
import ServicesSection from "../ServicesSection";

/**
 * Second Codex RC pass before 2.7.0-rc.19: with no instance routing key, a
 * personal OpenRouteService key saved in the expert form refreshed only the
 * form; the service badge and group totals read the page's own snapshot and
 * kept saying "nicht eingerichtet" — and removing a key the reverse.
 */
const status = (own: boolean, shared: boolean) => ({
  hasKey: own,
  isShared: shared,
  hasAccess: own || shared,
});
const allWith = (orsOwn: boolean) => ({
  airlabs: status(false, false),
  aviationstack: status(false, false),
  aerodatabox: status(false, false),
  aeroapi: status(false, false),
  opensky: status(false, false),
  openrouteservice: status(orsOwn, false),
  graphhopper: status(false, false),
});

const page = (orsOwn: boolean) =>
  ({
    user: { isAdmin: false },
    apiKeysStatus: allWith(orsOwn),
  }) as unknown as Parameters<typeof ServicesSection>[0]["page"];

const orsRow = (): HTMLElement =>
  document.querySelector(
    '[data-service-group="routing"] [data-service="openrouteservice"]'
  ) as HTMLElement;

describe("ServicesSection — routing badge follows the personal key form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.updateApiKeys.mockResolvedValue({ message: "ok" });
  });

  it("badges OpenRouteService as the account's own once the personal key is saved", async () => {
    api.getApiKeys.mockResolvedValueOnce(allWith(false)).mockResolvedValue(allWith(true));
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ServicesSection page={page(false)} />
      </MemoryRouter>
    );
    await screen.findByText("settings:routingPersonal.openrouteservice.label");
    expect(orsRow()).toHaveTextContent("settings:services.badge.none");

    await user.click(screen.getByRole("button", { name: /settings:services\.groups\.routing/ }));
    await user.click(screen.getAllByRole("button", { name: "common:buttons.edit" })[0]);
    await user.type(
      screen.getByLabelText("settings:routingPersonal.openrouteservice.label"),
      "my-ors-key"
    );
    await user.click(screen.getByTestId("routing-personal-save"));

    await waitFor(() => expect(orsRow()).toHaveTextContent("settings:services.badge.own"));
  });

  it("badges OpenRouteService as not set up once the personal key is removed", async () => {
    api.getApiKeys.mockResolvedValueOnce(allWith(true)).mockResolvedValue(allWith(false));
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ServicesSection page={page(true)} />
      </MemoryRouter>
    );
    await user.click(await screen.findByTestId("routing-personal-remove-openrouteservice"));
    await user.click(screen.getByTestId("routing-personal-save"));

    await waitFor(() => expect(orsRow()).toHaveTextContent("settings:services.badge.none"));
  });
});
