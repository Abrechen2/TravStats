import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { accountOverview, adminOverview, service, mockedApi, t } from "./fixtures";

vi.mock("../../../hooks/useTranslation", () => ({ useTranslation: () => ({ t }) }));
vi.mock("../../../lib/api/externalServices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/externalServices")>()),
  externalServicesApi: mockedApi,
}));
vi.mock("../SpecialisedControl", () => ({
  replacesGenericFields: () => false,
  SpecialisedControl: () => <div />,
}));
vi.mock("../../../hooks/useToursVisible", () => ({ useToursVisible: () => true }));
vi.mock("../../Settings/PhotoJourneyNightlyScanCard", () => ({ default: () => <div /> }));
vi.mock("../../Settings/StravaConnectionCard", () => ({ default: () => <div /> }));
vi.mock("../../Settings/WebdavSyncRow", () => ({ WebdavSyncPanel: () => <div /> }));

import AdminExternalServices from "../AdminExternalServices";
import AccountExternalServices from "../AccountExternalServices";

const adminRow = (id: string): HTMLElement =>
  document.querySelector(`[data-service-row="${id}"]`) as HTMLElement;
const acctRow = (id: string): HTMLElement =>
  document.querySelector(`[data-account-row="${id}"]`) as HTMLElement;

function renderAdmin(services: ReturnType<typeof service>[]) {
  const overview = adminOverview();
  mockedApi.adminOverview.mockResolvedValue({
    ...overview,
    categories: [{ id: "flight", services }],
  });
  return render(
    <MemoryRouter>
      <AdminExternalServices />
    </MemoryRouter>
  );
}

describe("Administration › Externe Dienste: what each row says", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a local Ollama shows no cloud warning, no consent button, and 'Adresse fehlt' (not 'Schlüssel fehlt') without its URL", async () => {
    renderAdmin([
      service({
        id: "ollama",
        level: "instance",
        credential: "url",
        configured: false,
        instanceSource: "none",
        allowAccountKeys: null,
        lastTest: null,
      }),
    ]);
    await screen.findByText("externalServices:services.ollama.purpose");
    const ollama = adminRow("ollama");
    expect(within(ollama).queryByText("externalServices:dataLeaves")).toBeNull();
    expect(within(ollama).getByText("externalServices:status.missingUrl")).toBeInTheDocument();
    expect(within(ollama).queryByText("externalServices:status.missing")).toBeNull();
  });

  it("a remote Ollama (consent block present) says its data leaves the server", async () => {
    renderAdmin([
      service({
        id: "ollama",
        level: "instance",
        credential: "url",
        allowAccountKeys: null,
        consent: { allowedByAdmin: true, accountsConsented: 0 },
      }),
    ]);
    await screen.findByText("externalServices:services.ollama.purpose");
    expect(within(adminRow("ollama")).getByText("externalServices:dataLeaves")).toBeInTheDocument();
  });

  it("an instance-only service switched off does not claim to block accounts' own keys", async () => {
    renderAdmin([
      service({ id: "smtp", level: "instance", enabled: false, allowAccountKeys: null }),
      service({ id: "airlabs", level: "instanceAndAccount", enabled: false }),
    ]);
    await screen.findByText("externalServices:services.smtp.purpose");
    expect(
      within(adminRow("smtp")).getByText("externalServices:test.offPlain")
    ).toBeInTheDocument();
    expect(within(adminRow("smtp")).queryByText("externalServices:test.offBlocks")).toBeNull();
    expect(
      within(adminRow("airlabs")).getByText("externalServices:test.offBlocks")
    ).toBeInTheDocument();
  });

  it("Immich, Strava and WebDAV describe the instance part; Dawarich has no service row", async () => {
    renderAdmin([
      service({ id: "immich", level: "instanceAndAccount", allowAccountKeys: null }),
      service({ id: "strava", level: "instanceAndAccount", allowAccountKeys: null }),
      service({ id: "webdav", level: "instanceAndAccount", allowAccountKeys: null }),
    ]);
    await screen.findByText("externalServices:services.immich.adminPurpose");
    expect(screen.getByText("externalServices:services.strava.adminPurpose")).toBeInTheDocument();
    expect(screen.getByText("externalServices:services.webdav.adminPurpose")).toBeInTheDocument();
    expect(adminRow("dawarich")).toBeNull();
  });
});

describe("Einstellungen › Dienste: own-key rows name their source", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows 'Kein Schlüssel' (not 'Nicht verbunden') when neither the account nor the instance has a key", async () => {
    const overview = accountOverview();
    mockedApi.accountOverview.mockResolvedValue({
      ...overview,
      ownKeys: [
        ...overview.ownKeys,
        {
          ...overview.ownKeys[1],
          id: "openrouteservice",
          effectiveSource: "none",
          configured: false,
        },
      ],
    });
    render(<AccountExternalServices />);
    await screen.findByText("externalServices:account.sections.ownKeys");
    const ors = acctRow("openrouteservice");
    expect(within(ors).getByText("externalServices:accountStatus.noKey")).toBeInTheDocument();
    expect(within(ors).queryByText("externalServices:accountStatus.notConnected")).toBeNull();
    expect(
      within(acctRow("airlabs")).getByText("externalServices:accountStatus.ownKey")
    ).toBeInTheDocument();
    expect(
      within(acctRow("aviationstack")).getByText("externalServices:accountStatus.viaInstance")
    ).toBeInTheDocument();
  });

  it("shows 'Aus' when the admin switched the service off", async () => {
    const overview = accountOverview();
    mockedApi.accountOverview.mockResolvedValue({
      ...overview,
      ownKeys: [{ ...overview.ownKeys[1], effectiveSource: "off" }],
    });
    render(<AccountExternalServices />);
    await screen.findByText("externalServices:account.sections.ownKeys");
    expect(
      within(acctRow("aviationstack")).getByText("externalServices:accountStatus.off")
    ).toBeInTheDocument();
  });
});
