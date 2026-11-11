import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ServerAddresses from "../ServerAddresses";
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

describe("Adressen & Passkeys", () => {
  it("names an address without its scheme under the field and keeps Speichern off", async () => {
    render(<ServerAddresses />);
    const address = await field("pairurl");
    await userEvent.type(address, "trav.example");
    expect(screen.getByText("settingsRows:server.errors.scheme")).toBeInTheDocument();
    const save = screen.getAllByRole("button", { name: "settings:blocks.save.saveGroup" })[0];
    expect(save).toBeDisabled();
  });

  it("keeps the typed address and says why when the server refuses the save", async () => {
    api.updateInstanceSettings.mockRejectedValue(httpError(400));
    render(<ServerAddresses />);
    const address = await field("pairurl");
    await userEvent.type(address, "https://phones.example");
    await userEvent.click(
      screen.getAllByRole("button", { name: "settings:blocks.save.saveGroup" })[0]
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("settings:blocks.save.failed")
    );
    expect(address).toHaveValue("https://phones.example");
    expect(screen.getByRole("button", { name: "settings:blocks.save.discardGroup" })).toBeEnabled();
  });

  it("writes the two addresses of its group and leaves the public address alone", async () => {
    api.updateInstanceSettings.mockResolvedValue(answer({ lanUrl: "http://192.168.1.10:3010" }));
    render(<ServerAddresses />);
    await userEvent.type(await field("lanurl"), "http://192.168.1.10:3010");
    await userEvent.click(
      screen.getAllByRole("button", { name: "settings:blocks.save.saveGroup" })[0]
    );
    await waitFor(() =>
      expect(api.updateInstanceSettings).toHaveBeenCalledWith({
        publicUrl: "",
        lanUrl: "http://192.168.1.10:3010",
      })
    );
    expect(api.updateInstanceSettings.mock.calls[0][0]).not.toHaveProperty("frontendUrl");
  });

  it("asks before changing a passkey domain that is already set, and writes nothing before the answer", async () => {
    api.getInstanceSettings.mockResolvedValue(answer({ webauthnRpId: "old.example" }));
    api.updateInstanceSettings.mockResolvedValue(answer({ webauthnRpId: "new.example" }));
    render(<ServerAddresses />);
    const domain = await field("rpid");
    await userEvent.clear(domain);
    await userEvent.type(domain, "new.example");
    await userEvent.click(
      screen.getAllByRole("button", { name: "settings:blocks.save.saveGroup" })[1]
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("settingsRows:dialogs.rpid.title");
    expect(api.updateInstanceSettings).not.toHaveBeenCalled();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "settingsRows:dialogs.rpid.confirm" })
    );
    await waitFor(() =>
      expect(api.updateInstanceSettings).toHaveBeenCalledWith({
        webauthnRpId: "new.example",
        webauthnOrigins: [],
      })
    );
  });

  it("refuses an IP address as the passkey domain before it is sent", async () => {
    render(<ServerAddresses />);
    await userEvent.type(await field("rpid"), "192.168.1.5");
    expect(screen.getByText("settingsRows:server.errors.domain")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "settings:blocks.save.saveGroup" })[1]
    ).toBeDisabled();
  });
});
