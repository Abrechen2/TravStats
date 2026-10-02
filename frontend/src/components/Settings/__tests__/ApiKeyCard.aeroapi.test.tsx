import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * FlightAware AeroAPI is a fifth flight-data key, wired exactly like
 * AeroDataBox: a user card in the settings section, an admin card in the
 * global-keys manager, and a Test button that goes through `settingsApi` for
 * the user card and `adminApi` for the admin card.
 */
const { adminTestApiKey, settingsTestApiKey, getApiKeyQuotas } = vi.hoisted(() => ({
  adminTestApiKey: vi.fn(),
  settingsTestApiKey: vi.fn(),
  getApiKeyQuotas: vi.fn(),
}));

vi.mock("../../../lib/api", () => ({
  adminApi: { testApiKey: adminTestApiKey },
  settingsApi: { testApiKey: settingsTestApiKey, getApiKeyQuotas },
}));
vi.mock("../../../lib/api/flights", () => ({
  flightsApi: { bulkRefreshPreview: vi.fn(), bulkRefreshRun: vi.fn() },
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));

import ApiKeysSection from "../ApiKeysSection";
import GlobalApiKeysManager, { type GlobalApiKeys } from "../../Admin/GlobalApiKeysManager";

const status = { hasKey: false, isShared: false, hasAccess: false };
const apiKeys = {
  airlabsApiKey: "",
  aviationstackApiKey: "",
  aerodataboxApiKey: "",
  aeroapiApiKey: "",
  openskyClientId: "",
  openskyClientSecret: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  getApiKeyQuotas.mockResolvedValue({});
  settingsTestApiKey.mockResolvedValue({ success: true, message: "ok" });
  adminTestApiKey.mockResolvedValue({ success: true, message: "ok" });
});

describe("settings section — AeroAPI card", () => {
  const renderSection = (onSetApiKeys = vi.fn(), hasKey = false) =>
    render(
      <ApiKeysSection
        apiKeysStatus={{
          airlabs: status,
          aviationstack: status,
          aerodatabox: status,
          aeroapi: { ...status, hasKey, hasAccess: hasKey },
          opensky: status,
        }}
        apiKeys={apiKeys}
        loadingApiKeys={false}
        onSetApiKeys={onSetApiKeys}
        onSave={() => {}}
      />
    );

  it("renders the AeroAPI row with its label and hint", async () => {
    renderSection();
    expect(await screen.findByText("settings:apiKeys.aeroapi.label")).toBeInTheDocument();
    expect(await screen.findByText("settings:apiKeys.aeroapi.description")).toBeInTheDocument();
  });

  it("writes an edited value into aeroapiApiKey only", async () => {
    const onSetApiKeys = vi.fn();
    renderSection(onSetApiKeys);
    const row = screen
      .getByText("settings:apiKeys.aeroapi.label")
      .closest("li, div[class]")!.parentElement!;
    const edit = Array.from(row.querySelectorAll("button")).find((b) =>
      /edit/i.test(b.textContent ?? "")
    );
    if (edit) await userEvent.click(edit);
    await userEvent.type(await screen.findByLabelText("settings:apiKeys.aeroapi.label"), "k");
    expect(onSetApiKeys).toHaveBeenLastCalledWith({ ...apiKeys, aeroapiApiKey: "k" });
  });

  it("Test routes through settingsApi with provider 'aeroapi'", async () => {
    renderSection(vi.fn(), true);
    const label = screen.getByText("settings:apiKeys.aeroapi.label");
    const row = label.closest("li, div[class]")!.parentElement!;
    const edit = Array.from(row.querySelectorAll("button")).find((b) =>
      /edit/i.test(b.textContent ?? "")
    );
    if (edit) await userEvent.click(edit);
    const input = await screen.findByLabelText("settings:apiKeys.aeroapi.label");
    await userEvent.type(input, "abc");
    const test = (await screen.findAllByRole("button", { name: "settings:apiKeys.test" })).slice(
      -1
    )[0];
    await userEvent.click(test);
    await waitFor(() => expect(settingsTestApiKey).toHaveBeenCalledWith("aeroapi", "abc"));
    expect(adminTestApiKey).not.toHaveBeenCalled();
  });
});

describe("admin manager — AeroAPI card", () => {
  const globalKeys: GlobalApiKeys = {
    allowUserFlightApiKeys: true,
    globalAeroapiApiKey: "abcd****wxyz",
  };

  it("shows the masked global key and routes a change into globalAeroapiApiKey", async () => {
    const onChange = vi.fn();
    render(
      <GlobalApiKeysManager
        globalApiKeys={globalKeys}
        parserSettings={{ allowUserApiKeys: true }}
        saving={false}
        onSave={() => {}}
        onGlobalApiKeysChange={onChange}
        onParserSettingsChange={() => {}}
      />
    );
    expect(screen.getByText("admin:globalApiKeys.aeroapi.label")).toBeInTheDocument();
    const input = await screen.findByLabelText("admin:globalApiKeys.aeroapi.label");
    await userEvent.type(input, "Z");
    expect(onChange).toHaveBeenLastCalledWith({
      ...globalKeys,
      globalAeroapiApiKey: "abcd****wxyzZ",
    });
  });
});
