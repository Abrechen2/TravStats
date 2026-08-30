import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import RoutingProviderSection from "../RoutingProviderSection";
import { adminApi } from "../../../lib/api";
import { logger } from "../../../lib/logger";

vi.mock("../../../lib/api", () => ({
  adminApi: {
    getGlobalApiKeys: vi.fn(),
    updateGlobalApiKeys: vi.fn(),
    testApiKey: vi.fn(),
  },
  settingsApi: {
    testApiKey: vi.fn(),
  },
}));

vi.mock("../../../lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// The wrapper returns the raw key, same convention every other Settings
// test in this repo uses — assertions read as i18n keys, not German/English
// copy that a later task (Task 8) still has to write.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const NONE_FIXTURE = {
  routingProvider: null,
  routingCustomUrl: null,
  allowUserFlightApiKeys: true,
};

describe("RoutingProviderSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing for non-admins, and never calls the GET", () => {
    const { container } = render(<RoutingProviderSection isAdmin={false} />);

    expect(container).toBeEmptyDOMElement();
    expect(adminApi.getGlobalApiKeys).not.toHaveBeenCalled();
  });

  it("renders a load-error state with no fields and no save button when the GET fails", async () => {
    vi.mocked(adminApi.getGlobalApiKeys).mockRejectedValue(new Error("network exploded"));

    render(<RoutingProviderSection isAdmin={true} />);

    await waitFor(() => expect(screen.getByTestId("routing-load-error")).toBeInTheDocument());

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText("common:buttons.save")).not.toBeInTheDocument();
    expect(logger.error).toHaveBeenCalled();
    expect(adminApi.updateGlobalApiKeys).not.toHaveBeenCalled();
  });

  it("shows only the 'no provider' hint when none is selected", async () => {
    vi.mocked(adminApi.getGlobalApiKeys).mockResolvedValue(NONE_FIXTURE);

    render(<RoutingProviderSection isAdmin={true} />);

    const select = await screen.findByRole("combobox");
    expect((select as HTMLSelectElement).value).toBe("");
    expect(screen.getByText("settings:routing.noneHint")).toBeInTheDocument();
    expect(screen.queryByText("settings:routing.openrouteservice.label")).not.toBeInTheDocument();
    expect(screen.queryByText("settings:routing.graphhopper.label")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("settings:routing.customUrlLabel")).not.toBeInTheDocument();
  });

  it("shows only the OpenRouteService key field when that provider is selected, hiding GraphHopper and the custom URL", async () => {
    vi.mocked(adminApi.getGlobalApiKeys).mockResolvedValue({
      ...NONE_FIXTURE,
      routingProvider: "openrouteservice",
      globalOpenrouteserviceApiKey: "abcd****wxyz",
    });

    render(<RoutingProviderSection isAdmin={true} />);

    expect(await screen.findByText("settings:routing.openrouteservice.label")).toBeInTheDocument();
    expect(screen.queryByText("settings:routing.graphhopper.label")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("settings:routing.customUrlLabel")).not.toBeInTheDocument();
    expect((screen.getByDisplayValue("abcd****wxyz") as HTMLInputElement).value).toBe(
      "abcd****wxyz"
    );
  });

  it("shows only the GraphHopper key field when that provider is selected", async () => {
    vi.mocked(adminApi.getGlobalApiKeys).mockResolvedValue({
      ...NONE_FIXTURE,
      routingProvider: "graphhopper",
      globalGraphhopperApiKey: "efgh****uvwx",
    });

    render(<RoutingProviderSection isAdmin={true} />);

    expect(await screen.findByText("settings:routing.graphhopper.label")).toBeInTheDocument();
    expect(screen.queryByText("settings:routing.openrouteservice.label")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("settings:routing.customUrlLabel")).not.toBeInTheDocument();
  });

  it("shows only the custom URL field when 'custom' is selected", async () => {
    vi.mocked(adminApi.getGlobalApiKeys).mockResolvedValue({
      ...NONE_FIXTURE,
      routingProvider: "custom",
      routingCustomUrl: "https://osrm.example.com",
    });

    render(<RoutingProviderSection isAdmin={true} />);

    const urlInput = await screen.findByLabelText("settings:routing.customUrlLabel");
    expect((urlInput as HTMLInputElement).value).toBe("https://osrm.example.com");
    expect(screen.queryByText("settings:routing.openrouteservice.label")).not.toBeInTheDocument();
    expect(screen.queryByText("settings:routing.graphhopper.label")).not.toBeInTheDocument();
    // No test button exists for a self-hosted OSRM URL — no backend test
    // endpoint exists for it, so offering one would be a control whose
    // only possible outcome is an error.
    expect(screen.queryByText("settings:apiKeys.test")).not.toBeInTheDocument();
  });

  it("switching the provider swaps which field is shown", async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.getGlobalApiKeys).mockResolvedValue(NONE_FIXTURE);

    render(<RoutingProviderSection isAdmin={true} />);

    const select = await screen.findByRole("combobox");
    await user.selectOptions(select, "graphhopper");
    expect(screen.getByText("settings:routing.graphhopper.label")).toBeInTheDocument();

    await user.selectOptions(select, "custom");
    expect(screen.queryByText("settings:routing.graphhopper.label")).not.toBeInTheDocument();
    expect(screen.getByLabelText("settings:routing.customUrlLabel")).toBeInTheDocument();

    await user.selectOptions(select, "");
    expect(screen.queryByLabelText("settings:routing.customUrlLabel")).not.toBeInTheDocument();
    expect(screen.getByText("settings:routing.noneHint")).toBeInTheDocument();
  });

  it("saves the selected provider and custom URL via PUT", async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.getGlobalApiKeys).mockResolvedValue(NONE_FIXTURE);
    vi.mocked(adminApi.updateGlobalApiKeys).mockResolvedValue({
      message: "Global API keys updated successfully",
    });

    render(<RoutingProviderSection isAdmin={true} />);

    const select = await screen.findByRole("combobox");
    await user.selectOptions(select, "custom");
    await user.type(
      screen.getByLabelText("settings:routing.customUrlLabel"),
      "https://osrm.example.com"
    );

    await user.click(screen.getByText("common:buttons.save"));

    await waitFor(() =>
      expect(adminApi.updateGlobalApiKeys).toHaveBeenCalledWith(
        expect.objectContaining({
          routingProvider: "custom",
          routingCustomUrl: "https://osrm.example.com",
        })
      )
    );
    expect(await screen.findByText("Global API keys updated successfully")).toBeInTheDocument();
  });

  it("shows a translated failure message (and logs) when the save fails", async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.getGlobalApiKeys).mockResolvedValue(NONE_FIXTURE);
    vi.mocked(adminApi.updateGlobalApiKeys).mockRejectedValue(new Error("save exploded"));

    render(<RoutingProviderSection isAdmin={true} />);

    await screen.findByRole("combobox");
    await user.click(screen.getByText("common:buttons.save"));

    expect(await screen.findByText("settings:routing.saveError")).toBeInTheDocument();
    expect(logger.error).toHaveBeenCalled();
  });

  it("reports the connection test's success and failure distinctly", async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.getGlobalApiKeys).mockResolvedValue({
      ...NONE_FIXTURE,
      routingProvider: "openrouteservice",
      globalOpenrouteserviceApiKey: "abcd****wxyz",
    });
    vi.mocked(adminApi.testApiKey).mockResolvedValueOnce({
      success: true,
      message: "API key is valid",
    });

    render(<RoutingProviderSection isAdmin={true} />);

    await screen.findByText("settings:routing.openrouteservice.label");
    await user.click(screen.getByText("settings:apiKeys.test"));

    expect(await screen.findByText("API key is valid")).toBeInTheDocument();
    expect(adminApi.testApiKey).toHaveBeenCalledWith("openrouteservice", "abcd****wxyz");

    vi.mocked(adminApi.testApiKey).mockResolvedValueOnce({
      success: false,
      message: "API key is invalid",
    });
    await user.click(screen.getByText("settings:apiKeys.test"));

    expect(await screen.findByText("API key is invalid")).toBeInTheDocument();
    // Both outcomes rendered — the earlier success message is gone, this is
    // a REPLACEMENT of the result, not an accumulation of both.
    expect(screen.queryByText("API key is valid")).not.toBeInTheDocument();
  });
});
