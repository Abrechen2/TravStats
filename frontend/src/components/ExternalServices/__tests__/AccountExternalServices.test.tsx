import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { accountOverview, apiError, mockedApi, t } from "./fixtures";

vi.mock("../../../hooks/useTranslation", () => ({ useTranslation: () => ({ t }) }));
vi.mock("../../../lib/api/externalServices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/externalServices")>()),
  externalServicesApi: mockedApi,
}));
vi.mock("../../Settings/PhotoJourneyNightlyScanCard", () => ({
  default: () => <div data-testid="nightly-scan" />,
}));
vi.mock("../../Settings/StravaConnectionCard", () => ({
  default: () => <div data-testid="strava-card" />,
}));

import AccountExternalServices from "../AccountExternalServices";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";

const row = (id: string): HTMLElement =>
  document.querySelector(`[data-account-row="${id}"]`) as HTMLElement;

describe("Einstellungen › Dienste", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsLevelStore.setState({ level: "standard" });
    mockedApi.accountOverview.mockResolvedValue(accountOverview());
    mockedApi.accountUpdate.mockResolvedValue(undefined);
    mockedApi.accountSetAiConsent.mockResolvedValue(undefined);
  });

  it("lists connections, own keys and AI approvals with the status of this account", async () => {
    render(<AccountExternalServices />);
    await screen.findByText("externalServices:account.sections.connections");
    expect(
      within(row("dawarich")).getByText("externalServices:accountStatus.notConnected")
    ).toBeInTheDocument();
    expect(
      within(row("webdav")).getByText("externalServices:accountStatus.connected")
    ).toBeInTheDocument();
    expect(
      within(row("airlabs")).getByText("externalServices:accountStatus.ownKey")
    ).toBeInTheDocument();
    expect(
      within(row("aviationstack")).getByText("externalServices:accountStatus.viaInstance")
    ).toBeInTheDocument();
    expect(
      within(row("openai")).getByText("externalServices:accountStatus.notConsented")
    ).toBeInTheDocument();
    expect(
      within(row("anthropic")).getByText("externalServices:accountStatus.consented")
    ).toBeInTheDocument();
  });

  it("sends no consent until this account ticks the box, then sends it for that provider only", async () => {
    render(<AccountExternalServices />);
    await screen.findByText("externalServices:account.sections.ai");
    fireEvent.click(
      within(row("openai")).getByRole("button", { name: "externalServices:account.action.consent" })
    );
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", {
      name: "externalServices:consent.account.confirm",
    });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(mockedApi.accountSetAiConsent).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(confirm);
    await waitFor(() => expect(mockedApi.accountSetAiConsent).toHaveBeenCalledWith("openai", true));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps the dialog open and says why when the consent could not be stored", async () => {
    mockedApi.accountSetAiConsent.mockRejectedValue(apiError(403, "CONNECTION_NOT_ALLOWED"));
    render(<AccountExternalServices />);
    await screen.findByText("externalServices:account.sections.ai");
    fireEvent.click(
      within(row("openai")).getByRole("button", { name: "externalServices:account.action.consent" })
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "externalServices:consent.account.confirm" })
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "externalServices:errors.CONNECTION_NOT_ALLOWED"
    );
  });

  it("withdraws a consent in one click and names the provider in the not-consented line", async () => {
    render(<AccountExternalServices />);
    await screen.findByText("externalServices:account.sections.ai");
    // Withdrawal copy names the provider (spec invariant 4), never 'all local'.
    expect(row("openai")).toHaveTextContent('"name":"externalServices:services.openai.name"');
    fireEvent.click(
      within(row("anthropic")).getByRole("button", {
        name: "externalServices:account.action.withdraw",
      })
    );
    await waitFor(() =>
      expect(mockedApi.accountSetAiConsent).toHaveBeenCalledWith("anthropic", false)
    );
  });

  it("removes only the own key, so the instance's key applies again", async () => {
    render(<AccountExternalServices />);
    await screen.findByText("externalServices:account.sections.ownKeys");
    fireEvent.click(
      within(row("airlabs")).getByRole("button", { name: "externalServices:account.action.change" })
    );
    fireEvent.click(screen.getByRole("button", { name: "externalServices:account.removeKey" }));
    await waitFor(() =>
      expect(mockedApi.accountUpdate).toHaveBeenCalledWith("airlabs", { fields: { apiKey: "" } })
    );
  });

  it("turns a service off for this account only, and back on again", async () => {
    render(<AccountExternalServices />);
    await screen.findByText("externalServices:account.sections.ownKeys");
    fireEvent.click(
      within(row("airlabs")).getByRole("button", { name: "externalServices:account.action.change" })
    );
    fireEvent.click(screen.getByRole("button", { name: "externalServices:account.disableForMe" }));
    await waitFor(() =>
      expect(mockedApi.accountUpdate).toHaveBeenCalledWith("airlabs", { accountDisabled: true })
    );
  });

  it("offers the 'turn back on' action for a service this account switched off", async () => {
    const data = accountOverview();
    data.ownKeys[0] = { ...data.ownKeys[0], accountDisabled: true, effectiveSource: "off" };
    mockedApi.accountOverview.mockResolvedValue(data);
    render(<AccountExternalServices />);
    await screen.findByText("externalServices:account.sections.ownKeys");
    expect(row("airlabs")).toHaveTextContent("externalServices:account.detail.disabledByMe");
    fireEvent.click(
      within(row("airlabs")).getByRole("button", { name: "externalServices:account.action.turnOn" })
    );
    await waitFor(() =>
      expect(mockedApi.accountUpdate).toHaveBeenCalledWith("airlabs", { accountDisabled: false })
    );
  });

  it("connects with the typed login fields as password inputs and reports a stored-but-failing key", async () => {
    mockedApi.accountOverview.mockResolvedValueOnce(accountOverview()).mockResolvedValue({
      ...accountOverview(),
      connections: [
        {
          ...accountOverview().connections[0],
          effectiveSource: "account",
          configured: true,
          lastTest: { at: "2026-10-30T13:00:00Z", ok: false, reason: "unreachable" },
        },
        accountOverview().connections[1],
      ],
    });
    render(<AccountExternalServices />);
    await screen.findByText("externalServices:account.sections.connections");
    fireEvent.click(
      within(row("dawarich")).getByRole("button", {
        name: "externalServices:account.action.connect",
      })
    );
    const key = screen.getByLabelText("externalServices:fields.dawarich.apiKey");
    expect(key).toHaveAttribute("type", "password");
    fireEvent.change(screen.getByLabelText("externalServices:fields.dawarich.serverUrl"), {
      target: { value: "https://dawarich.example" },
    });
    fireEvent.change(key, { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "externalServices:actions.saveAndTest" }));
    await waitFor(() =>
      expect(mockedApi.accountUpdate).toHaveBeenCalledWith("dawarich", {
        fields: { serverUrl: "https://dawarich.example", apiKey: "secret" },
      })
    );
    // The page does not claim success: the server's own test failed.
    expect(await within(row("dawarich")).findByRole("alert")).toHaveTextContent(
      "externalServices:test.reasons.unreachable"
    );
  });

  it("keeps the form and shows the refusal when the instance does not allow own keys", async () => {
    mockedApi.accountUpdate.mockRejectedValue(apiError(403, "ACCOUNT_KEYS_NOT_ALLOWED"));
    render(<AccountExternalServices />);
    await screen.findByText("externalServices:account.sections.ownKeys");
    fireEvent.click(
      within(row("aviationstack")).getByRole("button", {
        name: "externalServices:account.action.addOwn",
      })
    );
    fireEvent.change(screen.getByLabelText("externalServices:fields.aviationstack.apiKey"), {
      target: { value: "k" },
    });
    fireEvent.click(screen.getByRole("button", { name: "externalServices:actions.saveAndTest" }));
    expect(await within(row("aviationstack")).findByRole("alert")).toHaveTextContent(
      "externalServices:errors.ACCOUNT_KEYS_NOT_ALLOWED"
    );
    expect(
      screen.getByLabelText("externalServices:fields.aviationstack.apiKey")
    ).toBeInTheDocument();
  });

  it("keeps the instance's services collapsed and read-only", async () => {
    render(<AccountExternalServices />);
    const block = await screen.findByTestId("instance-provided");
    expect(within(block).queryByText("externalServices:services.aeroapi.name")).toBeNull();
    fireEvent.click(within(block).getByRole("button", { name: /externalServices:instance.title/ }));
    expect(within(block).getByText("externalServices:services.aeroapi.name")).toBeInTheDocument();
    // Only the toggle itself is a button: nothing here can be changed.
    expect(within(block).getAllByRole("button")).toHaveLength(1);
  });

  it("shows only the sections the admin allows", async () => {
    mockedApi.accountOverview.mockResolvedValue({
      connections: [],
      ownKeys: [],
      aiConsents: [],
      instanceProvided: [],
    });
    render(<AccountExternalServices />);
    await screen.findByText("externalServices:account.intro");
    expect(screen.queryByText("externalServices:account.sections.connections")).toBeNull();
    expect(screen.queryByText("externalServices:account.sections.ai")).toBeNull();
  });

  it("says the server cannot be reached instead of showing an empty page", async () => {
    mockedApi.accountOverview.mockRejectedValue(
      Object.assign(new Error("Network Error"), { isAxiosError: true })
    );
    render(<AccountExternalServices />);
    expect(await screen.findByRole("alert")).toHaveTextContent("externalServices:errors.network");
  });

  it("never says 'tested' when the server's test result is missing from the answer", async () => {
    // First answer: the page. Every later one has no lastTest for the service.
    render(<AccountExternalServices />);
    await screen.findByText("externalServices:account.sections.ownKeys");
    fireEvent.click(
      within(row("aviationstack")).getByRole("button", {
        name: "externalServices:account.action.addOwn",
      })
    );
    fireEvent.change(screen.getByLabelText("externalServices:fields.aviationstack.apiKey"), {
      target: { value: "k" },
    });
    fireEvent.click(screen.getByRole("button", { name: "externalServices:actions.saveAndTest" }));
    await waitFor(() => expect(mockedApi.accountUpdate).toHaveBeenCalled());
    await waitFor(() =>
      expect(row("aviationstack")).toHaveTextContent("externalServices:account.savedUnverified")
    );
    expect(row("aviationstack")).not.toHaveTextContent("externalServices:account.savedAndTested");
  });

  it("does not say 'tested' when the reload after the save failed", async () => {
    mockedApi.accountOverview
      .mockResolvedValueOnce(accountOverview())
      .mockRejectedValue(Object.assign(new Error("Network Error"), { isAxiosError: true }));
    render(<AccountExternalServices />);
    await screen.findByText("externalServices:account.sections.ownKeys");
    fireEvent.click(
      within(row("aviationstack")).getByRole("button", {
        name: "externalServices:account.action.addOwn",
      })
    );
    fireEvent.change(screen.getByLabelText("externalServices:fields.aviationstack.apiKey"), {
      target: { value: "k" },
    });
    fireEvent.click(screen.getByRole("button", { name: "externalServices:actions.saveAndTest" }));
    await waitFor(() =>
      expect(row("aviationstack")).toHaveTextContent("externalServices:account.savedUnverified")
    );
  });

  it("keeps the nightly photo scan reachable under the Immich connection", async () => {
    const data = accountOverview();
    data.connections.push({
      id: "immich",
      recommended: "free",
      effectiveSource: "account",
      accountDisabled: false,
      configured: true,
      lastTest: null,
      fields: [{ key: "serverUrl", kind: "url", value: "https://i.example", expert: false }],
    });
    mockedApi.accountOverview.mockResolvedValue(data);
    render(<AccountExternalServices />);
    await screen.findByText("externalServices:account.sections.connections");
    expect(screen.queryByTestId("nightly-scan")).toBeNull();
    fireEvent.click(
      within(row("immich")).getByRole("button", { name: "externalServices:account.action.change" })
    );
    expect(screen.getByTestId("nightly-scan")).toBeInTheDocument();
  });

  it("does not unlock a row that is still saving when another row finishes", async () => {
    let releaseSlow: () => void = () => {};
    mockedApi.accountUpdate.mockImplementation((id: string) =>
      id === "airlabs"
        ? new Promise<void>((resolve) => {
            releaseSlow = resolve;
          })
        : Promise.resolve()
    );
    render(<AccountExternalServices />);
    await screen.findByText("externalServices:account.sections.ownKeys");
    fireEvent.click(
      within(row("airlabs")).getByRole("button", { name: "externalServices:account.action.change" })
    );
    fireEvent.click(screen.getByRole("button", { name: "externalServices:account.disableForMe" }));
    await waitFor(() =>
      expect(
        within(row("airlabs")).getByRole("button", {
          name: "externalServices:account.action.change",
        })
      ).toBeDisabled()
    );
    // A second row saves and finishes meanwhile.
    fireEvent.click(
      within(row("aviationstack")).getByRole("button", {
        name: "externalServices:account.action.addOwn",
      })
    );
    fireEvent.change(screen.getByLabelText("externalServices:fields.aviationstack.apiKey"), {
      target: { value: "k" },
    });
    fireEvent.click(screen.getByRole("button", { name: "externalServices:actions.saveAndTest" }));
    await waitFor(() =>
      expect(mockedApi.accountUpdate).toHaveBeenCalledWith("aviationstack", expect.anything())
    );
    await waitFor(() =>
      expect(row("aviationstack")).toHaveTextContent("externalServices:account.savedUnverified")
    );
    expect(
      within(row("airlabs")).getByRole("button", { name: "externalServices:account.action.change" })
    ).toBeDisabled();
    await act(async () => {
      releaseSlow();
    });
    await waitFor(() =>
      expect(
        within(row("airlabs")).getByRole("button", {
          name: "externalServices:account.action.change",
        })
      ).toBeEnabled()
    );
  });
});
