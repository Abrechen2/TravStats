import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import RoutingProviderRow from "../RoutingProviderRow";

const update = vi.fn().mockResolvedValue({ message: "ok" });
vi.mock("../../../lib/api/admin", () => ({
  adminApi: {
    getGlobalApiKeys: vi.fn().mockResolvedValue({
      routingProvider: null,
      globalGraphhopperApiKey: "gh12****abcd",
    }),
    updateGlobalApiKeys: (...a: unknown[]) => update(...a),
  },
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${String(o.provider)}` : k),
  }),
}));
vi.mock("../servicesContext", () => ({
  useServices: () => ({ account: { reload: vi.fn().mockResolvedValue(null), data: undefined } }),
}));

describe("RoutingProviderRow restore path (#411)", () => {
  it("offers the provider whose key is stored when the choice is empty, and sets it in one click", async () => {
    render(<RoutingProviderRow />);
    const use = await screen.findByRole("button", {
      name: "settingsRows:services.routing.useKeyed:GraphHopper",
    });
    expect(screen.getByTestId("routing-use-keyed")).toHaveTextContent(
      "settingsRows:services.routing.emptyWithKey:GraphHopper"
    );
    fireEvent.click(use);
    await waitFor(() => expect(update).toHaveBeenCalledWith({ routingProvider: "graphhopper" }));
  });
});
