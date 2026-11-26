import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import RoutingFailingNotice from "../RoutingFailingNotice";
import { logger } from "../../../lib/logger";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${String(o.provider)}` : k),
  }),
}));

describe("RoutingFailingNotice (#411)", () => {
  it("says the provider refuses requests and warns in the console, instead of straight lines in silence", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    render(
      <MemoryRouter>
        <RoutingFailingNotice failing={{ providerId: "openrouteservice", reason: "auth" }} />
      </MemoryRouter>
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "trips:tours.routing.providerFailing:OpenRouteService"
    );
    expect(warn).toHaveBeenCalled();
  });

  it("says nothing while the provider answers", () => {
    render(
      <MemoryRouter>
        <RoutingFailingNotice failing={null} />
      </MemoryRouter>
    );
    expect(screen.queryByTestId("routing-failing-notice")).toBeNull();
  });
});
