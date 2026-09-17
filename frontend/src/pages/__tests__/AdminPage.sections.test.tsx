import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminPage from "../AdminPage";

/**
 * Round 4 ("one page, anchor jumps" — tester feedback, forgejo#…): the admin
 * page used to hold every section's data but mount only the ONE picked by
 * `activeSection` state, swapping the whole `<main>` out on every click —
 * unlike the settings page, whose index is a set of `<a href="#settings-…">`
 * jumps into one long page. This file pins the same shape for admin: every
 * section of the active tab renders at once, and the index draws anchors
 * instead of buttons that used to pick which single section was mounted.
 *
 * Deliberate-break protocol: put back the pre-round-4
 * `{activeSection === "system" && <SystemInfoTab .../>}` style conditional
 * around each section in AdminPage.tsx and the first test below fails
 * (only "admin:tabs.system" is in the document).
 */

// AppShell always renders NavigationBar, which asks for the running version
// on mount — unmocked, that is a real, always-failing XHR in jsdom
// (forgejo#110's exact shape). SettingsPage's own tests stub it the same way.
vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-bar-stub" />,
}));

// The four "eager" sections (system, users, invitations, parsers) are the
// ones AdminPage already loads unconditionally today via loadData()'s
// Promise.all, regardless of which section is picked — that has not
// changed here. Every other general-tab section (instance, backups, smtp,
// externalServices, logging) is wrapped in LazySection, and in jsdom there
// is no IntersectionObserver, so those sections' real content deliberately
// never mounts (see LazySection's doc comment) — nothing beyond these four
// endpoints needs mocking for this file's assertions.
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    adminApi: {
      ...actual.adminApi,
      getSystemInfo: vi.fn().mockResolvedValue({
        instanceName: "TravStats",
        userCount: 1,
        activeUserCount: 1,
        flightCount: 0,
        maxUsers: 10,
        warningThreshold: false,
        registrationEnabled: false,
        version: "0.0.0-test",
        buildVersion: "0.0.0-test",
      }),
      getUsers: vi.fn().mockResolvedValue({ users: [] }),
      getInvitations: vi.fn().mockResolvedValue({ invitations: [] }),
      getAdminParserSettings: vi.fn().mockResolvedValue({
        allowUserApiKeys: false,
        fxCdnFallbackEnabled: false,
        defaultVisionParser: "template",
        defaultTextParser: "template",
        ollamaUrl: null,
        ollamaModel: null,
      }),
    },
  };
});

const renderAdmin = (entry = "/admin") =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <AdminPage />
    </MemoryRouter>
  );

describe("AdminPage — one page, anchor jumps", () => {
  beforeEach(() => {
    // jsdom has no scrollIntoView at all; SettingsPage guards for its
    // absence at runtime, but pinning the deep-link behaviour needs a spy.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("renders several sections of the active tab at once, not only one picked section", async () => {
    renderAdmin();

    // Today only the active section rendered; asserting on FOUR distinct
    // sections at once (not just two) is what the pre-round-4 page cannot
    // pass no matter which single section happened to be active.
    expect(await screen.findByRole("region", { name: "admin:tabs.system" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "admin:tabs.users" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "admin:tabs.invitations" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "admin:tabs.parsers" })).toBeInTheDocument();
  });

  it("gives every section landmark its admin-<id> anchor id, lazy sections included", async () => {
    renderAdmin();
    await screen.findByRole("region", { name: "admin:tabs.system" });

    for (const id of [
      "system",
      "instance",
      "users",
      "invitations",
      "externalServices",
      "parsers",
      "logging",
      "backups",
      "smtp",
    ]) {
      expect(document.getElementById(`admin-${id}`)).not.toBeNull();
    }
  });

  it("draws the section index as anchors into the page, not buttons that swap sections", async () => {
    renderAdmin();
    await screen.findByRole("region", { name: "admin:tabs.system" });

    const sectionNav = screen.getByRole("navigation", { name: "admin:sectionPicker" });
    const links = within(sectionNav).getAllByRole("link");
    expect(links.length).toBeGreaterThanOrEqual(9); // the general tab's own sections
    expect(links.some((link) => link.getAttribute("href") === "#admin-system")).toBe(true);
    expect(links.some((link) => link.getAttribute("href") === "#admin-logging")).toBe(true);

    // The old column picked a section with a button; none should remain here.
    expect(within(sectionNav).queryAllByRole("button")).toHaveLength(0);
  });

  it("scrolls a ?section= deep link into view once the page has rendered", async () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;

    renderAdmin("/admin?section=logging");
    await screen.findByRole("region", { name: "admin:tabs.system" });

    await waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1));
    expect(scrollSpy.mock.instances[0]).toBe(document.getElementById("admin-logging"));
  });

  it("does not scroll anywhere without a ?section= param", async () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;

    renderAdmin("/admin");
    await screen.findByRole("region", { name: "admin:tabs.system" });

    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
