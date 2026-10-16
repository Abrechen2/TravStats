import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import ShareLinksSection from "../ShareLinksSection";
import { shareLinksApi } from "../../../lib/api/shareLinks";
import { adminApi } from "../../../lib/api";

/**
 * "Öffentliche Links" (forgejo#281): the caller's live links with reach and
 * end, each revocable; the instance switch for an admin only, and its state
 * read back from the server after a toggle.
 */

vi.mock("../../../lib/api/shareLinks", () => ({
  shareLinksApi: { list: vi.fn(), preview: vi.fn(), create: vi.fn(), revoke: vi.fn() },
}));
vi.mock("../../../lib/api", () => ({ adminApi: { updateInstanceSettings: vi.fn() } }));

const addToast = vi.fn();
const toastState = { addToast: (...args: unknown[]) => addToast(...args) };
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: typeof toastState) => unknown) => selector(toastState),
}));

const api = vi.mocked(shareLinksApi);
const admin = vi.mocked(adminApi);
const link = {
  id: "l1",
  kind: "trip" as const,
  targetId: "t1",
  fields: ["name"],
  expiresAt: "2030-06-08T10:00:00.000Z",
  effectiveExpiresAt: "2030-06-08T10:00:00.000Z",
  createdAt: "2030-06-01T10:00:00.000Z",
  viewCount: 3,
  lastViewedAt: null,
};

const renderSection = (isAdmin: boolean) =>
  render(
    <MemoryRouter>
      <ShareLinksSection isAdmin={isAdmin} />
    </MemoryRouter>
  );

describe("ShareLinksSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue({ enabled: true, links: [link] });
    api.revoke.mockResolvedValue();
  });

  it("lists a live link with its reach and revokes it", async () => {
    renderSection(false);
    expect(await screen.findByText(/sharing:links.section.views/)).toBeTruthy();
    expect(screen.getByText(/sharing:links.section.adminOnly/)).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
    api.list.mockResolvedValue({ enabled: true, links: [] });
    await userEvent.click(screen.getByRole("button", { name: "sharing:links.section.revoke" }));
    await waitFor(() => expect(api.revoke).toHaveBeenCalledWith("l1"));
    expect(await screen.findByText("sharing:links.section.empty")).toBeTruthy();
    expect(addToast).toHaveBeenCalledWith("success", "sharing:links.section.revoked");
  });

  it("directs admins to instance administration without an instance switch here", async () => {
    renderSection(true);
    const link = await screen.findByRole("link", { name: "sharing:links.section.adminLink" });
    expect(link.getAttribute("href")).toBe("/admin?section=instance");
    expect(screen.queryByRole("switch")).toBeNull();
    expect(admin.updateInstanceSettings).not.toHaveBeenCalled();
  });

  it("says when the links cannot be loaded", async () => {
    api.list.mockRejectedValue(new Error("down"));
    renderSection(false);
    expect(await screen.findByText("sharing:links.section.loadFailed")).toBeTruthy();
  });
});
