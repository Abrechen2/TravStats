import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ServerGeneral from "../ServerGeneral";
import { resetInstanceStore } from "../instanceStore";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";
import { httpError, instance } from "./fixtures";

const api = vi.hoisted(() => ({ getInstanceSettings: vi.fn(), updateInstanceSettings: vi.fn() }));
vi.mock("../../../lib/api", () => ({ adminApi: api }));
vi.mock("../../Admin/LoginBackgroundsCard", () => ({ LoginBackgroundsCard: () => null }));

const status = { usable: false, reason: "notConfigured" };
const answer = (over = {}) => ({ settings: instance(over), passkeyStatus: status });

beforeEach(() => {
  vi.clearAllMocks();
  resetInstanceStore();
  useSettingsLevelStore.setState({ level: "expert" });
  api.getInstanceSettings.mockResolvedValue(answer());
});
afterEach(() => {
  cleanup();
  useSettingsLevelStore.setState({ level: null });
});

const field = async (title: string): Promise<HTMLElement> =>
  screen.findByLabelText(`settingsRows:server.${title}.t`);

describe("Allgemein › Dein Server", () => {
  it("warns for as long as the public address is missing, saved or not (B15)", async () => {
    api.getInstanceSettings.mockResolvedValue(answer({ frontendUrl: null }));
    render(<ServerGeneral />);
    await field("puburl");
    expect(screen.getByText("settingsRows:server.publicUrlMissing")).toBeInTheDocument();
    await userEvent.type(await field("puburl"), "https://trav.example");
    expect(screen.queryByText("settingsRows:server.publicUrlMissing")).toBeNull();
  });

  it("names a public address without its scheme under the field and keeps Speichern off", async () => {
    render(<ServerGeneral />);
    const address = await field("puburl");
    await userEvent.clear(address);
    await userEvent.type(address, "trav.example");
    expect(screen.getByText("settingsRows:server.errors.scheme")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "settings:blocks.save.saveGroup" })).toBeDisabled();
  });

  it("keeps the typed address and says why when the server refuses the save", async () => {
    api.updateInstanceSettings.mockRejectedValue(httpError(400));
    render(<ServerGeneral />);
    const address = await field("puburl");
    await userEvent.clear(address);
    await userEvent.type(address, "https://phones.example");
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.save.saveGroup" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("settings:blocks.save.failed")
    );
    expect(address).toHaveValue("https://phones.example");
    expect(screen.getByRole("button", { name: "settings:blocks.save.discardGroup" })).toBeEnabled();
  });

  it("says nothing was loaded instead of drawing a form that would save defaults", async () => {
    api.getInstanceSettings.mockRejectedValue(httpError());
    render(<ServerGeneral />);
    expect(await screen.findByText("settingsRows:server.loadFailed")).toBeInTheDocument();
    expect(screen.queryByLabelText("settingsRows:server.puburl.t")).toBeNull();
    api.getInstanceSettings.mockResolvedValue(answer());
    await userEvent.click(screen.getByRole("button", { name: "settingsRows:server.retry" }));
    expect(await field("puburl")).toBeInTheDocument();
  });

  it("writes the name and the public address as one group, and nothing of the other addresses", async () => {
    api.updateInstanceSettings.mockResolvedValue(answer({ instanceName: "Home" }));
    render(<ServerGeneral />);
    const name = await field("instname");
    await userEvent.clear(name);
    await userEvent.type(name, "Home");
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.save.saveGroup" }));
    await waitFor(() =>
      expect(api.updateInstanceSettings).toHaveBeenCalledWith({
        instanceName: "Home",
        frontendUrl: "https://trav.example",
      })
    );
    const sent = api.updateInstanceSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(sent).not.toHaveProperty("publicUrl");
    expect(sent).not.toHaveProperty("lanUrl");
  });
});
