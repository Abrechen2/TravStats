import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ImmichModeRow from "../ImmichModeRow";

const api = vi.hoisted(() => ({ getSettings: vi.fn(), updateSettings: vi.fn() }));
vi.mock("../../../lib/api/immich", async (original) => ({
  ...(await original<typeof import("../../../lib/api/immich")>()),
  immichApi: api,
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));

beforeEach(() => {
  vi.clearAllMocks();
  api.getSettings.mockResolvedValue({ defaultMode: "link" });
});
afterEach(cleanup);

describe("Dienste › Immich › Fotos verknüpfen oder kopieren", () => {
  it("writes the choice at once and keeps it when the server refuses it", async () => {
    api.updateSettings.mockRejectedValue(new Error("offline"));
    render(<ImmichModeRow />);
    const copy = await screen.findByRole("radio", { name: "immich:modeImport" });
    await userEvent.click(copy);
    expect(copy).toBeChecked();
    await waitFor(
      () => expect(api.updateSettings).toHaveBeenCalledWith({ defaultMode: "import" }),
      {
        timeout: 3000,
      }
    );
    await waitFor(() =>
      expect(screen.getByText(/settings:blocks.save.failed/)).toBeInTheDocument()
    );
    expect(screen.getByRole("radio", { name: "immich:modeImport" })).toBeChecked();
  });

  it("says the setting could not be read instead of showing the default as if it were saved", async () => {
    api.getSettings.mockRejectedValue(new Error("offline"));
    render(<ImmichModeRow />);
    expect(
      await screen.findByText("settingsRows:services.ui.immichModeLoadFailed")
    ).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
  });
});
