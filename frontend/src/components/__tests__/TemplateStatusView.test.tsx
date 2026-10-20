import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TemplateStatusView from "../TemplateStatusView";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { count?: number; date?: string }) =>
      [k, opts?.count, opts?.date].filter((part) => part !== undefined).join(":"),
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
  githubRepo: "https://github.com/Abrechen2/travstats-templates",
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

/**
 * forgejo#309 — a failed repository sync keeps the last good set, and the
 * page says so, with the date. Until now the failure reached only the log,
 * so a stale set looked exactly like a current one.
 */
describe("TemplateStatusView — a failed template sync is shown, not only logged", () => {
  const RAN_AT = "2027-03-02T07:15:00.000Z";
  const withV2 = (v2: unknown) => ({ ...status, v2 });

  beforeEach(() => {
    authState.user = { id: "u1", isAdmin: false };
    sync.mockReset();
  });

  it("says the index was unreachable at the last sync, when, and that the last set is in use", async () => {
    getStatus.mockReset().mockResolvedValue(
      withV2({
        index: "unavailable",
        ranAt: RAN_AT,
        templates: [
          {
            id: "rail:db-confirmation",
            domain: "rail",
            version: "1",
            state: "active",
            source: "cached",
          },
        ],
      })
    );
    render(<TemplateStatusView />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("parser:communityTemplates.sync.indexUnreachable:1");
    // The date of that sync, formatted for the reader — not left out.
    expect(alert).toHaveTextContent(/indexUnreachable:1:.*2027/);
  });

  it("lists each template that failed, with its reason", async () => {
    getStatus.mockReset().mockResolvedValue(
      withV2({
        index: "available",
        ranAt: RAN_AT,
        templates: [
          { id: "rail:ok", domain: "rail", version: "1", state: "active", source: "remote" },
          {
            id: "rental:broken",
            domain: "rental",
            version: "2",
            state: "rejected",
            source: "remote",
            reason: "tests_failed",
          },
        ],
      })
    );
    render(<TemplateStatusView />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("parser:communityTemplates.sync.rejectedTitle:1");
    expect(alert).toHaveTextContent("rental:broken v2");
    expect(alert).toHaveTextContent("parser:communityTemplates.sync.reasons.tests_failed");
    expect(alert).not.toHaveTextContent("rail:ok");
  });

  it("draws nothing when the last sync went through cleanly", async () => {
    getStatus.mockReset().mockResolvedValue(
      withV2({
        index: "available",
        ranAt: RAN_AT,
        templates: [
          { id: "rail:ok", domain: "rail", version: "1", state: "active", source: "remote" },
        ],
      })
    );
    render(<TemplateStatusView />);
    await screen.findByText("parser:communityTemplates.status.title");

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says a refresh failed instead of only logging it", async () => {
    authState.user = { id: "a1", isAdmin: true };
    getStatus.mockReset().mockResolvedValue(status);
    sync.mockRejectedValue(new Error("502"));
    render(<TemplateStatusView />);

    fireEvent.click(await screen.findByText("parser:communityTemplates.status.sync"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "parser:communityTemplates.status.syncFailed"
    );
  });
});
