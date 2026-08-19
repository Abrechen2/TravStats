import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Regression coverage for the Test button on the admin-only logostream and
 * Google Places cards. Both used to hard-disable the button via
 * `handleTest`'s early return (no backend endpoint existed); now that
 * `POST /admin/api-keys/test/logostream` and `/googlePlaces` exist, the
 * button must render enabled and route through `adminApi.testApiKey` —
 * never `settingsApi`, since neither provider has a user-level route.
 */
const { adminTestApiKey, settingsTestApiKey } = vi.hoisted(() => ({
  adminTestApiKey: vi.fn(),
  settingsTestApiKey: vi.fn(),
}));

vi.mock("../../../lib/api", () => ({
  adminApi: { testApiKey: adminTestApiKey },
  settingsApi: { testApiKey: settingsTestApiKey },
}));

// The wrapper returns the key itself, so assertions read as i18n keys.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import ApiKeyCard from "../ApiKeyCard";

beforeEach(() => {
  vi.clearAllMocks();
  adminTestApiKey.mockResolvedValue({ success: true, message: "API key is valid" });
});

describe("ApiKeyCard — logostream", () => {
  it("renders an enabled Test button for a logostream card with a value", async () => {
    render(
      <ApiKeyCard
        provider="logostream"
        label="logostream"
        description="logo provider"
        getKeyUrl="https://airline.logostream.dev/"
        isShared={false}
        hasAccess
        value="abcd****wxyz"
        isAdmin={true}
      />,
    );

    const button = await screen.findByRole("button", { name: "settings:apiKeys.test" });
    expect(button).toBeEnabled();
  });

  it("clicking Test calls adminApi.testApiKey with provider 'logostream', never settingsApi", async () => {
    render(
      <ApiKeyCard
        provider="logostream"
        label="logostream"
        description="logo provider"
        getKeyUrl="https://airline.logostream.dev/"
        isShared={false}
        hasAccess
        value="abcd****wxyz"
        isAdmin={true}
      />,
    );

    await userEvent.click(await screen.findByRole("button", { name: "settings:apiKeys.test" }));

    await waitFor(() => expect(adminTestApiKey).toHaveBeenCalledTimes(1));
    expect(adminTestApiKey).toHaveBeenCalledWith("logostream", "abcd****wxyz");
    expect(settingsTestApiKey).not.toHaveBeenCalled();
  });
});

describe("ApiKeyCard — googlePlaces", () => {
  it("renders an enabled Test button and calls adminApi.testApiKey with provider 'googlePlaces'", async () => {
    render(
      <ApiKeyCard
        provider="googlePlaces"
        label="Google Places"
        description="geocoder"
        getKeyUrl="https://console.cloud.google.com/google/maps-apis/credentials"
        isShared={false}
        hasAccess
        value="abcd****wxyz"
        isAdmin={true}
      />,
    );

    const button = await screen.findByRole("button", { name: "settings:apiKeys.test" });
    expect(button).toBeEnabled();

    await userEvent.click(button);

    await waitFor(() => expect(adminTestApiKey).toHaveBeenCalledTimes(1));
    expect(adminTestApiKey).toHaveBeenCalledWith("googlePlaces", "abcd****wxyz");
    expect(settingsTestApiKey).not.toHaveBeenCalled();
  });
});
