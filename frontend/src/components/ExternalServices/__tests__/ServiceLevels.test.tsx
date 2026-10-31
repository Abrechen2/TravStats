import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { adminOverview, service, mockedApi, t } from "./fixtures";

vi.mock("../../../hooks/useTranslation", () => ({ useTranslation: () => ({ t }) }));
vi.mock("../../../lib/api/externalServices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/externalServices")>()),
  externalServicesApi: mockedApi,
}));
vi.mock("../SpecialisedControl", () => ({
  replacesGenericFields: () => false,
  SpecialisedControl: () => null,
}));

import AdminExternalServices from "../AdminExternalServices";
import LegacyServiceSummary from "../LegacyServiceSummary";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";

const ollama = service({
  id: "ollama",
  category: "ai",
  level: "instance",
  credential: "url",
  configured: false,
  allowAccountKeys: null,
  lastTest: null,
  fields: [
    { key: "url", kind: "url", value: "", expert: true },
    { key: "model", kind: "text", value: "", expert: true },
    { key: "remoteOptIn", kind: "switch", value: false, expert: false },
  ],
});
const aeroapi = service({
  id: "aeroapi",
  level: "instance",
  allowAccountKeys: null,
  fields: [
    { key: "apiKey", kind: "secret", value: "•••• 1", masked: true, expert: false },
    {
      key: "tier",
      kind: "select",
      value: "personal_feeder",
      options: ["personal", "personal_feeder", "custom"],
      expert: false,
    },
  ],
});

function overviewWith(...services: ReturnType<typeof service>[]) {
  return { ...adminOverview(), categories: [{ id: "flight", services }] };
}

const row = (id: string): HTMLElement =>
  document.querySelector(`[data-service-row="${id}"]`) as HTMLElement;

function page(path = "/admin/externalServices") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AdminExternalServices />
    </MemoryRouter>
  );
}

describe("Externe Dienste: Standard and Expert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsLevelStore.setState({ level: "standard" });
    mockedApi.adminOverview.mockResolvedValue(overviewWith(ollama, aeroapi));
  });

  it("Standard hides the Ollama address and offers 'Einrichten', which reveals it for that row", async () => {
    page("/admin/externalServices?service=ollama");
    await screen.findByText("externalServices:services.ollama.purpose");
    const ollamaRow = row("ollama");
    expect(within(ollamaRow).queryByLabelText(/fields\.ollama\.url$/)).toBeNull();
    expect(within(ollamaRow).getByLabelText(/remoteOptIn$/)).toBeInTheDocument();
    fireEvent.click(
      within(ollamaRow).getByRole("button", { name: "externalServices:actions.setUp" })
    );
    expect(within(ollamaRow).getByLabelText(/fields\.ollama\.url$/)).toBeInTheDocument();
    expect(
      within(ollamaRow).queryByRole("button", { name: "externalServices:actions.setUp" })
    ).toBeNull();
  });

  it("Expert shows the address at once and no 'Einrichten'", async () => {
    useSettingsLevelStore.setState({ level: "expert" });
    page("/admin/externalServices?service=ollama");
    await screen.findByText("externalServices:services.ollama.purpose");
    expect(within(row("ollama")).getByLabelText(/fields\.ollama\.url$/)).toBeInTheDocument();
    expect(
      within(row("ollama")).queryByRole("button", { name: "externalServices:actions.setUp" })
    ).toBeNull();
  });

  it("an old deep link (?service=) opens that row; without it the rows stay shut", async () => {
    const { unmount } = page("/admin/externalServices");
    await screen.findByText("externalServices:services.ollama.purpose");
    expect(row("ollama").querySelector("select, input")).toBeNull();
    unmount();
    page("/admin/externalServices?service=ollama");
    await screen.findByText("externalServices:services.ollama.purpose");
    expect(row("ollama").querySelector("input")).not.toBeNull();
  });

  it("draws select options through label keys, never the raw stored value (personal_feeder)", async () => {
    page("/admin/externalServices?service=aeroapi");
    await screen.findByText("externalServices:services.aeroapi.purpose");
    const select = within(row("aeroapi")).getByRole("combobox");
    const labels = within(select)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(labels).toEqual([
      "externalServices:fieldOptions.aeroapi.tier.personal",
      "externalServices:fieldOptions.aeroapi.tier.personal_feeder",
      "externalServices:fieldOptions.aeroapi.tier.custom",
    ]);
  });
});

describe("a legacy service page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.adminOverview.mockResolvedValue(overviewWith(ollama));
  });

  it("renders the status and a link into Externe Dienste, not a form", async () => {
    render(
      <MemoryRouter>
        <LegacyServiceSummary serviceId="ollama" />
      </MemoryRouter>
    );
    expect(await screen.findByText("externalServices:legacy.status.attention")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "externalServices:actions.openInServices" });
    expect(link).toHaveAttribute("href", "/admin/externalServices?service=ollama");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says when the status cannot be loaded instead of showing nothing", async () => {
    mockedApi.adminOverview.mockRejectedValue(new Error("down"));
    render(
      <MemoryRouter>
        <LegacyServiceSummary serviceId="ollama" />
      </MemoryRouter>
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "externalServices:legacy.loadFailed"
    );
  });
});

describe("a remote Ollama consent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsLevelStore.setState({ level: "standard" });
    mockedApi.adminOverview.mockResolvedValue(overviewWith(ollama));
    mockedApi.adminUpdate.mockResolvedValue(undefined);
    mockedApi.adminTest.mockResolvedValue({ ok: true, reason: null, usedQuota: false });
  });

  it("is saved with the data-sharing confirmation, never as a bare field the server refuses (CONSENT_REQUIRED)", async () => {
    page("/admin/externalServices?service=ollama");
    await screen.findByText("externalServices:services.ollama.purpose");
    fireEvent.click(within(row("ollama")).getByLabelText(/remoteOptIn$/));
    fireEvent.click(
      within(row("ollama")).getByRole("button", { name: "externalServices:actions.saveAndTest" })
    );
    expect(mockedApi.adminUpdate).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "externalServices:consent.admin.confirm" })
    );
    await waitFor(() =>
      expect(mockedApi.adminUpdate).toHaveBeenCalledWith("ollama", {
        fields: { remoteOptIn: true },
        confirmDataSharing: true,
      })
    );
  });
});
