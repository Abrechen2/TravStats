import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { adminOverview, service, apiError, mockedApi, networkError, t } from "./fixtures";

vi.mock("../../../hooks/useTranslation", () => ({ useTranslation: () => ({ t }) }));
vi.mock("../../../lib/api/externalServices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/externalServices")>()),
  externalServicesApi: mockedApi,
}));
// The embedded legacy controls load their own data and have their own tests.
vi.mock("../SpecialisedControl", () => ({
  replacesGenericFields: (id: string) => id === "smtp",
  SpecialisedControl: ({ serviceId }: { serviceId: string }) => (
    <div data-testid={`legacy-${serviceId}`} />
  ),
}));

import AdminExternalServices from "../AdminExternalServices";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";

const row = (id: string): HTMLElement =>
  document.querySelector(`[data-service-row="${id}"]`) as HTMLElement;

const renderPage = () =>
  render(
    <MemoryRouter>
      <AdminExternalServices />
    </MemoryRouter>
  );

describe("Administration › Externe Dienste", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsLevelStore.setState({ level: "standard" });
    mockedApi.adminOverview.mockResolvedValue(adminOverview());
    mockedApi.adminUpdate.mockResolvedValue(undefined);
    mockedApi.adminSetConnection.mockResolvedValue(undefined);
  });

  it("shows an enabled service without its key as 'Schlüssel fehlt' and counts it under attention", async () => {
    renderPage();
    await screen.findByText("externalServices:services.adsbx.purpose");
    expect(within(row("adsbx")).getByText("externalServices:status.missing")).toBeInTheDocument();
    const tiles = screen.getByText("externalServices:summary.attention")
      .parentElement as HTMLElement;
    expect(tiles).toHaveTextContent("1");
    // enabled, configured, test ok
    expect(within(row("airlabs")).getByText("externalServices:status.active")).toBeInTheDocument();
    expect(within(row("openai")).getByText("externalServices:status.off")).toBeInTheDocument();
  });

  it("draws the AeroAPI budget bar in the service's own row", async () => {
    renderPage();
    await screen.findByText("externalServices:services.aeroapi.purpose");
    const bar = within(row("aeroapi")).getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "25");
    expect(row("aeroapi")).toHaveTextContent('"used":2.5');
    expect(within(row("airlabs")).queryByRole("progressbar")).toBeNull();
  });

  it("says why a test failed instead of a bare error", async () => {
    mockedApi.adminTest.mockResolvedValue({ ok: false, reason: "auth", usedQuota: false });
    renderPage();
    await screen.findByText("externalServices:services.airlabs.purpose");
    fireEvent.click(
      within(row("airlabs")).getByRole("button", { name: "externalServices:actions.test" })
    );
    expect(await within(row("airlabs")).findByRole("alert")).toHaveTextContent(
      "externalServices:test.reasons.auth"
    );
  });

  it("answers a test of a switched-off service with 'nothing is requested', not with an error", async () => {
    mockedApi.adminTest.mockRejectedValue(apiError(409, "SERVICE_DISABLED"));
    renderPage();
    await screen.findByText("externalServices:services.openai.purpose");
    fireEvent.click(
      within(row("openai")).getByRole("button", { name: "externalServices:actions.test" })
    );
    await within(row("openai")).findByText("externalServices:test.disabledNoCall");
    expect(within(row("openai")).queryByRole("alert")).toBeNull();
  });

  it("names an unreachable server when a test gets no response at all", async () => {
    mockedApi.adminTest.mockRejectedValue(networkError);
    renderPage();
    await screen.findByText("externalServices:services.airlabs.purpose");
    fireEvent.click(
      within(row("airlabs")).getByRole("button", { name: "externalServices:actions.test" })
    );
    expect(await within(row("airlabs")).findByRole("alert")).toHaveTextContent(
      "externalServices:errors.network"
    );
  });

  it("keeps the confirm button of the cloud-AI dialog disabled until the data-sharing box is ticked", async () => {
    renderPage();
    await screen.findByText("externalServices:services.openai.purpose");
    fireEvent.click(
      within(row("openai")).getByRole("button", { name: "externalServices:actions.expand" })
    );
    fireEvent.click(screen.getByRole("button", { name: "externalServices:consent.allow" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", {
      name: "externalServices:consent.admin.confirm",
    });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(mockedApi.adminUpdate).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mockedApi.adminUpdate).toHaveBeenCalledWith("openai", {
        enabled: true,
        confirmDataSharing: true,
      })
    );
  });

  it("keeps the consent dialog open and says so when the server still refuses the approval", async () => {
    mockedApi.adminUpdate.mockRejectedValue(apiError(400, "CONSENT_REQUIRED"));
    renderPage();
    await screen.findByText("externalServices:services.openai.purpose");
    fireEvent.click(
      within(row("openai")).getByRole("button", { name: "externalServices:actions.expand" })
    );
    fireEvent.click(screen.getByRole("button", { name: "externalServices:consent.allow" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "externalServices:consent.admin.confirm" })
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "externalServices:errors.CONSENT_REQUIRED"
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("withdraws an approved provider without asking again", async () => {
    renderPage();
    await screen.findByText("externalServices:services.anthropic.purpose");
    fireEvent.click(
      within(row("anthropic")).getByRole("button", { name: "externalServices:actions.expand" })
    );
    fireEvent.click(screen.getByRole("button", { name: "externalServices:consent.withdraw" }));
    await waitFor(() =>
      expect(mockedApi.adminUpdate).toHaveBeenCalledWith("anthropic", { enabled: false })
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("hides only expert fields in Standard and shows them in Expert", async () => {
    const { unmount } = renderPage();
    await screen.findByText("externalServices:services.geocoder.purpose");
    // Standard: the service is listed, its address field is not.
    fireEvent.click(
      within(row("geocoder")).getByRole("button", { name: "externalServices:actions.expand" })
    );
    expect(screen.queryByLabelText("externalServices:fields.geocoder.photonUrl")).toBeNull();
    expect(screen.getByText("externalServices:expertHidden")).toBeInTheDocument();
    unmount();

    useSettingsLevelStore.setState({ level: "expert" });
    renderPage();
    await screen.findByText("externalServices:services.geocoder.purpose");
    fireEvent.click(
      within(row("geocoder")).getByRole("button", { name: "externalServices:actions.expand" })
    );
    expect(screen.getByLabelText("externalServices:fields.geocoder.photonUrl")).toBeInTheDocument();
    expect(screen.getByText("externalServices:expert.order")).toBeInTheDocument();
  });

  it("draws secrets as password inputs and sends only the field that was changed", async () => {
    mockedApi.adminTest.mockResolvedValue({ ok: true, reason: null, usedQuota: false });
    renderPage();
    await screen.findByText("externalServices:services.airlabs.purpose");
    fireEvent.click(
      within(row("airlabs")).getByRole("button", { name: "externalServices:actions.expand" })
    );
    const input = screen.getByLabelText("externalServices:fields.airlabs.apiKey");
    expect(input).toHaveAttribute("type", "password");
    const save = screen.getByRole("button", { name: "externalServices:actions.saveAndTest" });
    fireEvent.change(input, { target: { value: "new-secret" } });
    fireEvent.click(save);
    await waitFor(() =>
      expect(mockedApi.adminUpdate).toHaveBeenCalledWith("airlabs", {
        fields: { apiKey: "new-secret" },
      })
    );
    await waitFor(() => expect(mockedApi.adminTest).toHaveBeenCalledWith("airlabs"));
  });

  it("does not test a key that failed to save", async () => {
    mockedApi.adminUpdate.mockRejectedValue(apiError(400, "VALIDATION_FAILED"));
    renderPage();
    await screen.findByText("externalServices:services.airlabs.purpose");
    fireEvent.click(
      within(row("airlabs")).getByRole("button", { name: "externalServices:actions.expand" })
    );
    fireEvent.change(screen.getByLabelText("externalServices:fields.airlabs.apiKey"), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "externalServices:actions.saveAndTest" }));
    expect(await within(row("airlabs")).findByRole("alert")).toHaveTextContent(
      "externalServices:errors.VALIDATION_FAILED"
    );
    expect(mockedApi.adminTest).not.toHaveBeenCalled();
  });

  it("switches account-owned keys per service and leaves them out for instance-only services", async () => {
    renderPage();
    await screen.findByText("externalServices:services.airlabs.purpose");
    fireEvent.click(
      within(row("airlabs")).getByRole("button", { name: "externalServices:actions.expand" })
    );
    fireEvent.click(screen.getByLabelText("externalServices:allowAccountKeys"));
    await waitFor(() =>
      expect(mockedApi.adminUpdate).toHaveBeenCalledWith("airlabs", { allowAccountKeys: false })
    );
    fireEvent.click(
      within(row("aeroapi")).getByRole("button", { name: "externalServices:actions.expand" })
    );
    expect(within(row("aeroapi")).queryByLabelText("externalServices:allowAccountKeys")).toBeNull();
  });

  it("lets the admin forbid a connection and says when that is refused", async () => {
    renderPage();
    await screen.findByTestId("connections-policy");
    fireEvent.click(screen.getByLabelText("externalServices:connections.immich.name"));
    await waitFor(() => expect(mockedApi.adminSetConnection).toHaveBeenCalledWith("immich", false));

    mockedApi.adminSetConnection.mockRejectedValue(apiError(400, "VALIDATION_FAILED"));
    fireEvent.click(screen.getByLabelText("externalServices:connections.strava.name"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "externalServices:errors.VALIDATION_FAILED"
    );
  });

  it("narrows the list with the recommended filter and the search, and says when nothing matches", async () => {
    renderPage();
    await screen.findByText("externalServices:services.airlabs.purpose");
    fireEvent.click(screen.getByRole("button", { name: "externalServices:filter.recommended" }));
    expect(row("airlabs")).not.toBeNull();
    expect(row("adsbx")).toBeNull();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz-nothing" } });
    expect(screen.getByText("externalServices:noResults")).toBeInTheDocument();
  });

  it("offers a retry when the overview cannot be loaded, instead of an empty page", async () => {
    mockedApi.adminOverview.mockRejectedValueOnce(networkError);
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("externalServices:errors.network");
    fireEvent.click(screen.getByRole("button", { name: "externalServices:actions.retry" }));
    await screen.findByText("externalServices:services.airlabs.purpose");
  });

  it("opens the info panel with the service's reasons and key link", async () => {
    renderPage();
    await screen.findByText("externalServices:services.airlabs.purpose");
    fireEvent.click(
      within(row("airlabs")).getByRole("button", { name: /externalServices:actions.info/ })
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("externalServices:services.airlabs.why");
    expect(dialog).toHaveTextContent("externalServices:services.airlabs.dataOut");
    expect(within(dialog).getByRole("link")).toHaveAttribute(
      "href",
      "externalServices:services.airlabs.getKeyUrl"
    );
  });

  it("shows an always-on service without an off switch and says why", async () => {
    mockedApi.adminOverview.mockResolvedValue({
      categories: [
        {
          id: "mapsRoutes",
          services: [
            service({ id: "geocoder", alwaysOn: true, level: "instance", allowAccountKeys: null }),
          ],
        },
      ],
      accountConnections: [],
    });
    renderPage();
    await screen.findByText("externalServices:services.geocoder.purpose");
    fireEvent.click(
      within(row("geocoder")).getByRole("button", { name: "externalServices:actions.expand" })
    );
    const note = row("geocoder").querySelector("[data-always-on]");
    expect(note).toHaveTextContent("externalServices:services.geocoder.alwaysOnWhy");
    expect(within(row("geocoder")).queryByText("externalServices:actions.turnOff")).toBeNull();
  });
});
