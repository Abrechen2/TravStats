import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const get = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/api/version", () => ({ versionApi: { get } }));
vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { version?: string }) => `${key} ${opts?.version ?? ""}`.trim(),
  }),
}));

import { VersionLine } from "../VersionLine";

/**
 * The browser look at iPad width found "TravStats 1.0.0" under the menu: the
 * frontend's package.json, which is not the product's version at all. The
 * line shows what the server reports, as the update badge does.
 */
describe("VersionLine", () => {
  it("shows the build the server reports, not the frontend package's number", async () => {
    get.mockResolvedValue({ version: "2.7.0", buildVersion: "2.7.0-rc.19" });
    render(<VersionLine />);
    expect(await screen.findByText("settings:menu.version 2.7.0-rc.19")).toBeInTheDocument();
    expect(screen.queryByText(/1\.0\.0/)).toBeNull();
  });

  it("shows nothing while the server has not answered, or when it cannot", async () => {
    get.mockRejectedValue(new Error("offline"));
    render(<VersionLine />);
    await Promise.resolve();
    expect(screen.queryByTestId("settings-version")).toBeNull();
  });
});
