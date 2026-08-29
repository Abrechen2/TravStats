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

const FAILURE_KINDS = [
  "notConfigured",
  "unreachable",
  "auth",
  "notFound",
  "protocol",
  "invalidUrl",
];

vi.mock("../../../lib/api/dawarich", () => ({
  dawarichApi: { getSettings, updateSettings, testConnection },
  isDawarichFailureKind: (v: unknown) => typeof v === "string" && FAILURE_KINDS.includes(v),
  dawarichFailureKind: (error: unknown) => {
    const kind = (error as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
    return typeof kind === "string" && FAILURE_KINDS.includes(kind) ? kind : null;
  },
  dawarichFailureKey: (kind: unknown) =>
    typeof kind === "string" && FAILURE_KINDS.includes(kind)
      ? `trips:tours.tracks.dawarich.errors.${kind}`
      : "trips:tours.tracks.dawarich.error",
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: mockTranslateFn,
    i18n: {},
    ready: true,
  }),
}));

import DawarichConnectionCard from "../DawarichConnectionCard";

const CONFIGURED = {
  baseUrl: "https://dawarich.lan",
  hasKey: true,
  source: "user" as const,
  isShared: false,
  hasAccess: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockTranslateFn.mockImplementation((key: string) => key);
  getSettings.mockResolvedValue(CONFIGURED);
  updateSettings.mockResolvedValue(CONFIGURED);
  testConnection.mockResolvedValue({
    success: true,
    message: "ok",
    details: { version: "0.24.0" },
  });
});

describe("DawarichConnectionCard", () => {
  it("loads the stored URL and shows that a key exists without revealing it", async () => {
    render(<DawarichConnectionCard />);

    await waitFor(() => {
      expect(screen.getByLabelText("trips:tours.dawarichSettings.baseUrl")).toHaveValue(
        "https://dawarich.lan"
      );
    });
    expect(screen.getByText("trips:tours.dawarichSettings.apiKeyStored")).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/secret/i)).not.toBeInTheDocument();
  });

  it("saves the URL and key together, without a mode toggle", async () => {
    const user = userEvent.setup();
    render(<DawarichConnectionCard />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.type(screen.getByLabelText("trips:tours.dawarichSettings.apiKey"), "new-key");
    await user.click(screen.getByRole("button", { name: "trips:tours.dawarichSettings.save" }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        baseUrl: "https://dawarich.lan",
        apiKey: "new-key",
      })
    );
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("omits apiKey from the payload when the field was left empty", async () => {
    const user = userEvent.setup();
    render(<DawarichConnectionCard />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "trips:tours.dawarichSettings.save" }));

    await waitFor(() => expect(updateSettings).toHaveBeenCalled());
    expect(updateSettings.mock.calls[0][0]).not.toHaveProperty("apiKey");
  });

  it("clears the stored key by sending an explicit null", async () => {
    const user = userEvent.setup();
    render(<DawarichConnectionCard />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.click(
      screen.getByRole("button", { name: "trips:tours.dawarichSettings.clearKey" })
    );

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ apiKey: null }));
  });

  it("shows the server version after a successful test", async () => {
    const user = userEvent.setup();
    render(<DawarichConnectionCard />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "trips:tours.dawarichSettings.test" }));

    await waitFor(() =>
      expect(screen.getByText("trips:tours.dawarichSettings.connected")).toBeInTheDocument()
    );
  });

  it("renders the TRANSLATED failure text, never the raw backend prose", async () => {
    mockTranslateFn.mockImplementation((key: string) => `T:${key}`);
    testConnection.mockResolvedValue({
      success: false,
      kind: "auth",
      message: "Dawarich rejected the key",
    });
    const user = userEvent.setup();
    render(<DawarichConnectionCard />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "T:trips:tours.dawarichSettings.test" }));

    await waitFor(() =>
      expect(screen.getByText("T:trips:tours.tracks.dawarich.errors.auth")).toBeInTheDocument()
    );
    expect(screen.queryByText("Dawarich rejected the key")).not.toBeInTheDocument();
  });

  it("falls back to the generic error key when the backend sends no/unknown kind", async () => {
    mockTranslateFn.mockImplementation((key: string) => `T:${key}`);
    testConnection.mockResolvedValue({
      success: false,
      kind: "someFutureKind",
      message: "raw prose we must not show",
    });
    const user = userEvent.setup();
    render(<DawarichConnectionCard />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "T:trips:tours.dawarichSettings.test" }));

    await waitFor(() =>
      expect(screen.getByText("T:trips:tours.tracks.dawarich.error")).toBeInTheDocument()
    );
    expect(screen.queryByText("raw prose we must not show")).not.toBeInTheDocument();
  });

  it("omits an empty baseUrl from the test payload (a global connection)", async () => {
    getSettings.mockResolvedValue({
      baseUrl: null,
      hasKey: false,
      source: "global" as const,
      isShared: true,
      hasAccess: true,
    });
    const user = userEvent.setup();
    render(<DawarichConnectionCard />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "trips:tours.dawarichSettings.test" }));

    await waitFor(() => expect(testConnection).toHaveBeenCalled());
    const body = testConnection.mock.calls[0][0];
    expect(body).not.toHaveProperty("baseUrl");
    expect(body).not.toHaveProperty("apiKey");
  });

  it("marks a globally-provided connection as shared", async () => {
    getSettings.mockResolvedValue({ ...CONFIGURED, source: "global", isShared: true });
    render(<DawarichConnectionCard />);
    await waitFor(() =>
      expect(screen.getByText("trips:tours.dawarichSettings.shared")).toBeInTheDocument()
    );
  });

  it("uses translated accessible names from labels, not hardcoded aria-labels", async () => {
    mockTranslateFn.mockImplementation((key: string) => `T:${key}`);

    render(<DawarichConnectionCard />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    expect(screen.getByLabelText("T:trips:tours.dawarichSettings.baseUrl")).toBeInTheDocument();
    expect(screen.getByLabelText("T:trips:tours.dawarichSettings.apiKey")).toBeInTheDocument();
  });
});
