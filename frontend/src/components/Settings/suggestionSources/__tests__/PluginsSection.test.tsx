import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}${JSON.stringify(o)}` : k),
  }),
}));
vi.mock("../../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
const api = vi.hoisted(() => ({
  list: vi.fn(),
  add: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  rotate: vi.fn(),
  test: vi.fn(),
  backfill: vi.fn(),
  reask: vi.fn(),
}));
vi.mock("../../../../lib/api/suggestionPlugins", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/api/suggestionPlugins")>()),
  suggestionPluginsApi: api,
}));

import PluginsSection from "../PluginsSection";

const PLUGIN = {
  id: "p1",
  name: "Archiv",
  url: "https://plugin.example.com/hook",
  precision: "100m" as const,
  enabled: true,
  backfillAllowed: false,
  secretSet: true,
  lastVersion: 1,
  lastOutcome: "auth",
  lastCalledAt: "2026-11-23T10:00:00Z",
  lastErrorAt: "2026-11-23T10:00:00Z",
  retryAt: null,
};

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  api.list.mockResolvedValue({ plugins: [PLUGIN], blocked: null });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.values(api).forEach((f) => f.mockReset());
});

describe("PluginsSection", () => {
  it("shows the last error by its reason", async () => {
    render(<PluginsSection />);
    expect(await screen.findByText(/plugins\.failure\.reason\.auth/)).toBeTruthy();
  });

  it("shows the secret once after adding, with 100 m as the default precision", async () => {
    api.add.mockResolvedValue({ plugin: PLUGIN, secret: "the-secret-once" });
    render(<PluginsSection />);
    await userEvent.click(await screen.findByText("suggestionSources:plugins.add"));
    await userEvent.type(screen.getByLabelText("suggestionSources:plugins.form.name"), "Neu");
    await userEvent.type(
      screen.getByLabelText("suggestionSources:plugins.form.url"),
      "https://p.example.com/"
    );
    await userEvent.click(screen.getByText("suggestionSources:plugins.form.save"));
    await waitFor(() =>
      expect(api.add).toHaveBeenCalledWith({
        name: "Neu",
        url: "https://p.example.com/",
        precision: "100m",
        backfillAllowed: false,
      })
    );
    expect(await screen.findByText("the-secret-once")).toBeTruthy();
    await userEvent.click(screen.getByText("suggestionSources:plugins.secret.done"));
    expect(screen.queryByText("the-secret-once")).toBeNull();
  });

  it("names a failed test's reason", async () => {
    api.test.mockRejectedValue({ response: { data: { error: "timeout", code: "PLUGIN_FAILED" } } });
    render(<PluginsSection />);
    await userEvent.click(await screen.findByText("suggestionSources:plugins.test.button"));
    expect(await screen.findAllByText(/plugins\.failure\.reason\.timeout/)).not.toHaveLength(0);
  });

  it("says what is sent", async () => {
    render(<PluginsSection />);
    expect(await screen.findByText("suggestionSources:plugins.sent.title")).toBeTruthy();
  });

  // UAT rc.45: "Letzte Antwort … 2026-11-24 09:56" was the stored UTC text.
  it("shows the last answer in the account's date format, not the stored UTC text", async () => {
    render(<PluginsSection />);
    const line = await screen.findByText(/lastAnswer/);
    expect(line.textContent).not.toContain("2026-11-23 10:00");
    expect(line.textContent).toContain("23.11.2026");
  });
});
