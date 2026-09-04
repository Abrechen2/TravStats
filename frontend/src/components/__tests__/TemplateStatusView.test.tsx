import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TemplateStatusView from "../TemplateStatusView";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { count?: number }) => (opts?.count !== undefined ? `${k}:${opts.count}` : k),
  }),
}));

const authState: { user: { id: string; isAdmin: boolean } | null } = { user: null };
vi.mock("../../store/authStore", () => ({
  useAuthStore: (selector: (s: typeof authState) => unknown) => selector(authState),
}));

const getStatus = vi.fn();
const sync = vi.fn();
vi.mock("../../lib/api", () => ({
  templateApi: {
    getStatus: (...args: unknown[]) => getStatus(...args),
    sync: (...args: unknown[]) => sync(...args),
  },
}));

const status = {
  templates: [{ iata: "LH", airline: "Lufthansa", version: "abcdef0123" }],
  total: 1,
  githubRepo: "https://github.com/Abrechen2/travstats-airline-templates",
};

describe("TemplateStatusView — the refresh is an admin action (forgejo#67)", () => {
  beforeEach(() => {
    getStatus.mockReset().mockResolvedValue(status);
    sync.mockReset().mockResolvedValue(status);
  });

  it("offers no refresh button to a non-admin, and says why", async () => {
    authState.user = { id: "u1", isAdmin: false };
    render(<TemplateStatusView />);
    await screen.findByText("parser:communityTemplates.status.title");

    expect(screen.queryByText("parser:communityTemplates.status.sync")).toBeNull();
    expect(screen.getByText(/parser:communityTemplates\.status\.adminOnly/)).toBeInTheDocument();
  });

  it("lets an admin refresh, and the refresh reaches the API", async () => {
    authState.user = { id: "a1", isAdmin: true };
    render(<TemplateStatusView />);
    const button = await screen.findByText("parser:communityTemplates.status.sync");

    fireEvent.click(button);

    await waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/parser:communityTemplates\.status\.adminOnly/)).toBeNull();
  });
});
