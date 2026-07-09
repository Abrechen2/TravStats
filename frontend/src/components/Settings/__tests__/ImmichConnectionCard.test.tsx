import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// vi.hoisted lets these vi.fn()s survive vi.mock factory hoisting and stay
// reachable from the test bodies below.
const { getSettings, updateSettings, testConnection } = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  testConnection: vi.fn(),
}));

const { mockTranslateFn } = vi.hoisted(() => ({
  mockTranslateFn: vi.fn((key: string) => key),
}));

vi.mock("../../../lib/api/immich", () => ({
  immichApi: { getSettings, updateSettings, testConnection },
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: mockTranslateFn,
    i18n: {},
    ready: true,
  }),
}));

import ImmichConnectionCard from "../ImmichConnectionCard";

const CONFIGURED = {
  baseUrl: "https://immich.lan",
  hasKey: true,
  defaultMode: "link" as const,
  source: "user" as const,
  isShared: false,
  hasAccess: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Reset mockTranslateFn to default behavior (return key as-is).
  mockTranslateFn.mockImplementation((key: string) => key);
  getSettings.mockResolvedValue(CONFIGURED);
  updateSettings.mockResolvedValue(CONFIGURED);
  testConnection.mockResolvedValue({
    success: true,
    message: "ok",
    details: { version: "1.138.2" },
  });
});

describe("ImmichConnectionCard", () => {
  it("loads the stored URL and shows that a key exists without revealing it", async () => {
    render(<ImmichConnectionCard />);

    await waitFor(() => {
      expect(screen.getByLabelText("baseUrl")).toHaveValue("https://immich.lan");
    });
    expect(screen.getByText("apiKeyStored")).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/secret/i)).not.toBeInTheDocument();
  });

  it("saves the URL, key and default mode together", async () => {
    const user = userEvent.setup();
    render(<ImmichConnectionCard />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.type(screen.getByLabelText("apiKey"), "new-key");
    await user.click(screen.getByRole("radio", { name: "modeImport" }));
    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        baseUrl: "https://immich.lan",
        apiKey: "new-key",
        defaultMode: "import",
      })
    );
  });

  it("omits apiKey from the payload when the field was left empty", async () => {
    const user = userEvent.setup();
    render(<ImmichConnectionCard />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(updateSettings).toHaveBeenCalled());
    expect(updateSettings.mock.calls[0][0]).not.toHaveProperty("apiKey");
  });

  it("clears the stored key by sending an explicit null", async () => {
    const user = userEvent.setup();
    render(<ImmichConnectionCard />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "clearKey" }));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ apiKey: null }));
  });

  it("shows the server version after a successful test", async () => {
    const user = userEvent.setup();
    render(<ImmichConnectionCard />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "test" }));

    await waitFor(() => expect(screen.getByText("connected")).toBeInTheDocument());
  });

  it("surfaces the failure message when the test fails", async () => {
    testConnection.mockResolvedValue({ success: false, message: "Immich rejected the API key" });
    const user = userEvent.setup();
    render(<ImmichConnectionCard />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "test" }));

    await waitFor(() =>
      expect(screen.getByText("Immich rejected the API key")).toBeInTheDocument()
    );
  });

  it("marks a globally-provided connection as shared", async () => {
    getSettings.mockResolvedValue({ ...CONFIGURED, source: "global", isShared: true });
    render(<ImmichConnectionCard />);
    await waitFor(() => expect(screen.getByText("shared")).toBeInTheDocument());
  });

  it("uses translated accessible names from labels, not hardcoded aria-labels", async () => {
    // This test verifies that accessible names follow the i18n translation,
    // not hardcoded literals. By mocking t to return distinct strings (T:baseUrl, etc.),
    // we prove the input's accessible name comes from the localized <label>, not an aria-label.
    // If aria-labels hardcode raw i18n keys, this test fails because the accessible name
    // will be the literal "baseUrl" (from aria-label), not "T:baseUrl" (from the label).
    mockTranslateFn.mockImplementation((key: string) => `T:${key}`);

    render(<ImmichConnectionCard />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    // Inputs should be accessible by their translated label text.
    expect(screen.getByLabelText("T:baseUrl")).toBeInTheDocument();
    expect(screen.getByLabelText("T:apiKey")).toBeInTheDocument();

    // Radios should be accessible by their translated label text.
    expect(screen.getByRole("radio", { name: "T:modeLink" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "T:modeImport" })).toBeInTheDocument();
  });
});
