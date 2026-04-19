import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Mock the lib/api module: keep everything real except for the endpoints
// NavigationBar calls so the tests do not hit the network.
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    settingsApi: {
      ...actual.settingsApi,
      update: vi.fn().mockResolvedValue(undefined),
    },
    pendingUpdatesApi: {
      ...actual.pendingUpdatesApi,
      getAll: vi.fn().mockResolvedValue({ count: 0, updates: [] }),
    },
  };
});

// Mock the auth store so we have a predictable logged-in user.
vi.mock("../../store/authStore", () => ({
  useAuthStore: () => ({
    user: { id: "u1", username: "tester", email: "t@t.de", isAdmin: false },
    logout: vi.fn().mockResolvedValue(undefined),
  }),
}));

// DiagnosticExportModal does a lot of work we don't need here.
vi.mock("../../components/DiagnosticExportModal", () => ({
  default: () => null,
}));

// Use the real settingsStore so useEnabledDomains reads actual state.
vi.unmock("../../store/settingsStore");

import NavigationBar from "../../components/NavigationBar";
import { useSettingsStore } from "../../store/settingsStore";

describe("NavigationBar domain gating", () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ["flight"] });
  });

  it("shows Flights link when flight domain enabled", () => {
    render(
      <MemoryRouter>
        <NavigationBar />
      </MemoryRouter>
    );
    expect(screen.getAllByRole("link", { name: /flights|flüge/i }).length).toBeGreaterThan(0);
  });

  it("hides Flights link when flight domain disabled", () => {
    useSettingsStore.setState({ enabledDomains: [] });
    render(
      <MemoryRouter>
        <NavigationBar />
      </MemoryRouter>
    );
    expect(screen.queryByRole("link", { name: /flights|flüge/i })).not.toBeInTheDocument();
  });
});
