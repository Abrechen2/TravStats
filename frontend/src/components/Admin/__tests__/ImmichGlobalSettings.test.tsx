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
  immichFailureKind: (error: unknown) => {
    const kind = (error as { response?: { data?: { error?: unknown } } } | undefined)?.response
      ?.data?.error;
    return typeof kind === "string" && FAILURE_KINDS.includes(kind) ? kind : null;
  },
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
  it("displays the baseUrl/apiKey exactly as returned by getAdminSettings (masking itself is enforced server-side)", async () => {
    render(<ImmichGlobalSettings />);
    expect(await screen.findByDisplayValue("https://immich.example.com")).toBeInTheDocument();
    expect(screen.getByDisplayValue("abcd****wxyz")).toBeInTheDocument();
  });

  it("does NOT render a save button when the initial load fails — a failed load must never be able to wipe the stored connection", async () => {
    // baseUrl/apiKey stay "" (their initial state) when getAdminSettings rejects.
    // That is visually IDENTICAL to "nothing configured yet". If the card still
    // rendered the editable form, clicking save would PUT {baseUrl: null,
    // apiKey: null} and the backend would execute that as an explicit CLEAR of
    // whatever connection is actually stored — destroying it without the admin
    // ever having seen it. The card must show an error state instead.
    getAdminSettings.mockRejectedValue(new Error("network down"));
    render(<ImmichGlobalSettings />);

    await waitFor(() => expect(getAdminSettings).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "admin.save" })).not.toBeInTheDocument();
    expect(updateAdminSettings).not.toHaveBeenCalled();
  });

  it("offers a retry after a failed load, and the retry can recover into the normal editable form", async () => {
    getAdminSettings.mockRejectedValueOnce(new Error("network down"));
    render(<ImmichGlobalSettings />);

    const retry = await screen.findByRole("button", { name: "errors.retry" });
    getAdminSettings.mockResolvedValueOnce({
      baseUrl: "https://immich.example.com",
      apiKey: "abcd****wxyz",
    });
    await userEvent.click(retry);

    expect(await screen.findByDisplayValue("https://immich.example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "admin.save" })).toBeInTheDocument();
  });

  it("renders the API key field as a password input, not readable on screen", async () => {
    render(<ImmichGlobalSettings />);
    const key = await screen.findByDisplayValue("abcd****wxyz");
    expect(key).toHaveAttribute("type", "password");
    expect(key).toHaveAttribute("autoComplete", "off");
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

  it("clearing only the base URL does NOT claim the connection was removed", async () => {
    // The PUT sends {baseUrl: null, apiKey: "abcd****wxyz"}. The backend's
    // `looksMasked()` guard KEEPS the stored key on an echoed mask, so the
    // response comes back with apiKey still set. The toast must reflect that
    // reality (admin.saved), not assert a full removal (admin.cleared) that
    // never happened.
    render(<ImmichGlobalSettings />);
    const url = await screen.findByDisplayValue("https://immich.example.com");
    updateAdminSettings.mockResolvedValue({
      baseUrl: null,
      apiKey: "abcd****wxyz",
    });

    await userEvent.clear(url);
    await userEvent.click(screen.getByRole("button", { name: "admin.save" }));

    await waitFor(() => expect(updateAdminSettings).toHaveBeenCalledTimes(1));
    expect(updateAdminSettings).toHaveBeenCalledWith({
      baseUrl: null,
      apiKey: "abcd****wxyz",
    });
    expect(addToast).toHaveBeenCalledWith("success", "admin.saved");
    expect(addToast).not.toHaveBeenCalledWith("success", "admin.cleared");
  });

  it("typing a brand-new plaintext key and saving sends the new value, not the mask", async () => {
    render(<ImmichGlobalSettings />);
    const key = await screen.findByDisplayValue("abcd****wxyz");
    updateAdminSettings.mockResolvedValue({
      baseUrl: "https://immich.example.com",
      apiKey: "brand-new-plaintext-key",
    });

    await userEvent.clear(key);
    await userEvent.type(key, "brand-new-plaintext-key");
    await userEvent.click(screen.getByRole("button", { name: "admin.save" }));

    await waitFor(() => expect(updateAdminSettings).toHaveBeenCalledTimes(1));
    expect(updateAdminSettings).toHaveBeenCalledWith({
      baseUrl: "https://immich.example.com",
      apiKey: "brand-new-plaintext-key",
    });
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

  it("testing an already-configured connection sends the stored pair, not an empty body", async () => {
    // With a URL and a masked key already loaded, both fields are non-empty and
    // must be sent as-is — correctness then depends on the backend's
    // masked-value fallback, not on the client omitting fields.
    render(<ImmichGlobalSettings />);
    await screen.findByDisplayValue("https://immich.example.com");

    await userEvent.click(screen.getByRole("button", { name: "admin.test" }));

    await waitFor(() => expect(testAdminConnection).toHaveBeenCalledTimes(1));
    expect(testAdminConnection).toHaveBeenCalledWith({
      baseUrl: "https://immich.example.com",
      apiKey: "abcd****wxyz",
    });
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
