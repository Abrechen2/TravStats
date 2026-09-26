import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Silent-failure review 2026-09-26: a failed key test printed the provider's
 * raw text — "getaddrinfo ENOTFOUND airlabs.co" — or axios's own sentence
 * into the settings card. The card shows the translated key only.
 */
const { adminTestApiKey, settingsTestApiKey } = vi.hoisted(() => ({
  adminTestApiKey: vi.fn(),
  settingsTestApiKey: vi.fn(),
}));
vi.mock("../../../lib/api", () => ({
  adminApi: { testApiKey: adminTestApiKey },
  settingsApi: { testApiKey: settingsTestApiKey },
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import ApiKeyCard from "../ApiKeyCard";

const renderCard = () =>
  render(
    <ApiKeyCard
      provider="airlabs"
      label="AirLabs"
      description="flight data"
      getKeyUrl="https://airlabs.co/"
      isShared={false}
      hasAccess
      value="abcd****wxyz"
      isAdmin={false}
    />
  );

describe("ApiKeyCard — a failed test speaks the reader's language", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows 'unreachable', with the raw text only as the tooltip", async () => {
    settingsTestApiKey.mockResolvedValue({
      success: false,
      message: "getaddrinfo ENOTFOUND airlabs.co",
      messageKey: "unreachable",
    });
    renderCard();
    await userEvent.click(await screen.findByRole("button", { name: "settings:apiKeys.test" }));

    const line = await screen.findByText("settings:apiKeyTest.unreachable");
    expect(line).toHaveAttribute("title", "getaddrinfo ENOTFOUND airlabs.co");
    expect(screen.queryByText(/ENOTFOUND/)).toBeNull();
  });

  it("never prints provider prose that carries no key", async () => {
    settingsTestApiKey.mockResolvedValue({ success: false, message: "Something upstream" });
    renderCard();
    await userEvent.click(await screen.findByRole("button", { name: "settings:apiKeys.test" }));

    expect(await screen.findByText("settings:apiKeyTest.providerError")).toBeInTheDocument();
    expect(screen.queryByText("Something upstream")).toBeNull();
  });

  it("reads a failed request as 'test failed', not axios's sentence", async () => {
    settingsTestApiKey.mockRejectedValue(new Error("Request failed with status code 502"));
    renderCard();
    await userEvent.click(await screen.findByRole("button", { name: "settings:apiKeys.test" }));

    expect(await screen.findByText("settings:apiKeyTest.requestFailed")).toBeInTheDocument();
    expect(screen.queryByText(/status code 502/)).toBeNull();
  });
});
