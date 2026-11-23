import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import RoutingProviderRow from "../RoutingProviderRow";

const update = vi.fn().mockResolvedValue({ message: "ok" });
const reload = vi.fn().mockResolvedValue(null);
vi.mock("../../../lib/api/admin", () => ({
  adminApi: {
    getGlobalApiKeys: vi.fn().mockResolvedValue({ routingProvider: "off" }),
    updateGlobalApiKeys: (...a: unknown[]) => update(...a),
  },
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../servicesContext", () => ({
  useServices: () => ({
    account: {
      reload,
      data: {
        routing: { mode: "off", selected: null, providerId: null, keySource: null, hint: "off" },
      },
    },
  }),
}));

describe("RoutingProviderRow", () => {
  it("shows the stored 'Aus' as its own choice and the effective result under it", async () => {
    render(<RoutingProviderRow />);
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("off"));
    expect(screen.getByTestId("routing-admin-effective").textContent).toBe(
      "settingsRows:services.routing.off"
    );
  });
});
