import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { api } from "../../../lib/api/client";
import WebDAVSettings from "../WebDAVSettings";

/**
 * "Test connection" asks the BACKEND to dial the STORED configuration:
 * `POST /admin/webdav-settings/test` reads `enabled` out of admin_settings and
 * answers 400 "WebDAV sync is disabled" when it is off. The button used to be
 * released by the unsaved `form.enabled`, so ticking the box and pressing test
 * produced a bare failure toast, and the only way to learn why was to guess
 * that saving comes first (beta report, 2026-09-12).
 */

const SETTINGS = {
  enabled: false,
  url: "https://cloud.example.com/remote.php/dav/files/demo/",
  username: "demo",
  passwordSet: true,
  backupPath: "/TravStats/backups/",
};

function mockLoad(overrides: Partial<typeof SETTINGS> = {}) {
  return vi
    .spyOn(api, "get")
    .mockResolvedValue({ data: { settings: { ...SETTINGS, ...overrides } } });
}

async function renderLoaded(overrides: Partial<typeof SETTINGS> = {}) {
  mockLoad(overrides);
  render(<WebDAVSettings />);
  await waitFor(() => expect(screen.getByText("admin:webdav.title")).toBeInTheDocument());
}

const testButton = () => screen.getByRole("button", { name: "admin:webdav.test" });

describe("WebDAVSettings — the connection test follows the SAVED configuration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not release the test button just because the checkbox was ticked", async () => {
    const post = vi.spyOn(api, "post");
    await renderLoaded({ enabled: false });

    fireEvent.click(screen.getByRole("checkbox"));

    expect(testButton()).toBeDisabled();
    expect(screen.getByText("admin:webdav.testNeedsSave")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("says the stored configuration has sync switched off, rather than failing blankly", async () => {
    await renderLoaded({ enabled: false });

    expect(testButton()).toBeDisabled();
    expect(screen.getByText("admin:webdav.testNeedsEnabled")).toBeInTheDocument();
  });

  it("tests when the saved configuration is enabled and untouched", async () => {
    const post = vi
      .spyOn(api, "post")
      .mockResolvedValue({ data: { success: true, message: "ok" } });
    await renderLoaded({ enabled: true });

    expect(screen.queryByText("admin:webdav.testNeedsSave")).not.toBeInTheDocument();
    expect(screen.queryByText("admin:webdav.testNeedsEnabled")).not.toBeInTheDocument();

    fireEvent.click(testButton());

    await waitFor(() => expect(post).toHaveBeenCalledWith("/admin/webdav-settings/test"));
  });

  it("withholds the test again as soon as a field is edited", async () => {
    await renderLoaded({ enabled: true });
    expect(testButton()).toBeEnabled();

    fireEvent.change(screen.getByLabelText("admin:webdav.fields.url.label"), {
      target: { value: "https://cloud.example.com/remote.php/dav/files/other/" },
    });

    expect(testButton()).toBeDisabled();
    expect(screen.getByText("admin:webdav.testNeedsSave")).toBeInTheDocument();
  });

  it("withholds the test while a new password is typed but not saved", async () => {
    await renderLoaded({ enabled: true });

    fireEvent.change(screen.getByLabelText("admin:webdav.fields.password.label"), {
      target: { value: "app-password" },
    });

    expect(testButton()).toBeDisabled();
    expect(screen.getByText("admin:webdav.testNeedsSave")).toBeInTheDocument();
  });
});
