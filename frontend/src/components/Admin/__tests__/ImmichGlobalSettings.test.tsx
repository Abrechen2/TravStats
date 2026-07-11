import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { getAdminSettings, updateAdminSettings, testAdminConnection } = vi.hoisted(() => ({
  getAdminSettings: vi.fn(),
  updateAdminSettings: vi.fn(),
  testAdminConnection: vi.fn(),
}));

const FAILURE_KINDS = [
  "notConfigured",
  "unreachable",
  "auth",
  "notFound",
  "protocol",
  "invalidUrl",
];

vi.mock("../../../lib/api/immich", () => ({
  immichApi: { getAdminSettings, updateAdminSettings, testAdminConnection },
  isImmichFailureKind: (v: unknown) => typeof v === "string" && FAILURE_KINDS.includes(v),
  failureKey: (kind: unknown) =>
    typeof kind === "string" && FAILURE_KINDS.includes(kind) ? `errors.${kind}` : "errors.unknown",
}));

// The wrapper returns the key itself, so assertions read as i18n keys.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: typeof addToast }) => unknown) =>
    selector({ addToast }),
}));

import ImmichGlobalSettings from "../ImmichGlobalSettings";

beforeEach(() => {
  vi.clearAllMocks();
  getAdminSettings.mockResolvedValue({
    baseUrl: "https://immich.example.com",
    apiKey: "abcd****wxyz",
  });
  updateAdminSettings.mockResolvedValue({
    baseUrl: "https://immich.example.com",
    apiKey: "abcd****wxyz",
  });
  testAdminConnection.mockResolvedValue({
    success: true,
    message: "",
    details: { version: "3.0.2" },
  });
});

describe("ImmichGlobalSettings", () => {
  it("shows the stored connection with the key MASKED, never in plaintext", async () => {
    render(<ImmichGlobalSettings />);
    expect(await screen.findByDisplayValue("https://immich.example.com")).toBeInTheDocument();
    expect(screen.getByDisplayValue("abcd****wxyz")).toBeInTheDocument();
  });

  it("saving an untouched key sends the mask back, never a new secret", async () => {
    // The backend's `looksMasked()` treats an echoed mask as "unchanged". The
    // card must therefore send the mask verbatim rather than an empty string,
    // which would be a real value and would wipe the stored key.
    render(<ImmichGlobalSettings />);
    await screen.findByDisplayValue("abcd****wxyz");
    await userEvent.click(screen.getByRole("button", { name: "admin.save" }));

    await waitFor(() => expect(updateAdminSettings).toHaveBeenCalledTimes(1));
    expect(updateAdminSettings).toHaveBeenCalledWith({
      baseUrl: "https://immich.example.com",
      apiKey: "abcd****wxyz",
    });
  });

  it("clearing both fields sends null for both and reports the connection removed", async () => {
    render(<ImmichGlobalSettings />);
    const url = await screen.findByDisplayValue("https://immich.example.com");
    const key = screen.getByDisplayValue("abcd****wxyz");
    updateAdminSettings.mockResolvedValue({ baseUrl: null, apiKey: null });

    await userEvent.clear(url);
    await userEvent.clear(key);
    await userEvent.click(screen.getByRole("button", { name: "admin.save" }));

    await waitFor(() => expect(updateAdminSettings).toHaveBeenCalledTimes(1));
    expect(updateAdminSettings).toHaveBeenCalledWith({ baseUrl: null, apiKey: null });
    expect(addToast).toHaveBeenCalledWith("success", "admin.cleared");
  });

  it("testing with untouched fields tests the STORED connection", async () => {
    // Empty strings would trip the schema's .min(1); the route falls back to the
    // stored pair only when the fields are absent.
    getAdminSettings.mockResolvedValue({ baseUrl: null, apiKey: null });
    render(<ImmichGlobalSettings />);
    await screen.findByRole("button", { name: "admin.test" });

    await userEvent.click(screen.getByRole("button", { name: "admin.test" }));

    await waitFor(() => expect(testAdminConnection).toHaveBeenCalledTimes(1));
    expect(testAdminConnection).toHaveBeenCalledWith({});
  });

  it("renders a localized message for a known failure kind", async () => {
    testAdminConnection.mockRejectedValue({ response: { data: { error: "auth" } } });
    render(<ImmichGlobalSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "admin.test" }));

    expect(await screen.findByText("errors.auth")).toBeInTheDocument();
  });

  it("falls back to errors.unknown for an unrecognised failure", async () => {
    testAdminConnection.mockRejectedValue({ response: { data: { error: "brand-new-kind" } } });
    render(<ImmichGlobalSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "admin.test" }));

    expect(await screen.findByText("errors.unknown")).toBeInTheDocument();
  });
});
