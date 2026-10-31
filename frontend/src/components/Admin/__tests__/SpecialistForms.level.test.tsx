/**
 * Settings redesign, package 4: the specialist forms embedded in Externe Dienste
 * honour the level in force. Standard keeps the switch, login and sender;
 * the port, TLS mode, relay address, backup path, template repository address
 * and a federation address that is already set are Expert fields.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import SmtpManager from "../SmtpManager";
import PushSettings from "../PushSettings";
import WebDAVSettings from "../WebDAVSettings";
import TemplateRepoSettings from "../TemplateRepoSettings";
import FederationSettings from "../FederationSettings";

const mocks = vi.hoisted(() => ({
  getSmtp: vi.fn(),
  getWebdav: vi.fn(),
  pushGet: vi.fn(),
  repoGet: vi.fn(),
  fedGet: vi.fn(),
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: () => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  adminApi: { getSmtpConfig: mocks.getSmtp, getWebDAVSettings: mocks.getWebdav },
  pushRelayApi: { get: mocks.pushGet },
}));
vi.mock("../../../lib/api/templateRepo", () => ({ templateRepoApi: { get: mocks.repoGet } }));
vi.mock("../../../lib/api/federationAdmin", async (original) => ({
  ...(await original<typeof import("../../../lib/api/federationAdmin")>()),
  federationAdminApi: { get: mocks.fedGet },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSmtp.mockResolvedValue({
    configured: true,
    host: "smtp.example.com",
    port: 465,
    secure: true,
    username: "u",
    fromEmail: "a@b.c",
    fromName: "TravStats",
    enabled: true,
  });
  mocks.pushGet.mockResolvedValue({
    pushEnabled: true,
    pushRelayUrl: "https://push.travstats.de",
    registered: true,
    pausedUntil: null,
    consentAt: null,
  });
  mocks.repoGet.mockResolvedValue({
    url: null,
    effectiveUrl: "https://x.example/t",
    origin: "default",
    defaultUrl: "https://x.example/t",
  });
  mocks.getWebdav.mockResolvedValue({
    settings: {
      enabled: true,
      url: "https://d/",
      username: "u",
      passwordSet: true,
      backupPath: "/b/",
    },
  });
});

const fed = (origin: string | null) => ({
  source: null,
  enabled: false,
  origin,
  publicKey: null,
  fingerprint: null,
  hasKey: false,
  tripSharingEnabled: false,
  peers: [],
});

describe("SMTP", () => {
  it("Standard hides port, TLS and sender name; Expert shows them", async () => {
    const { unmount } = render(<SmtpManager expert={false} />);
    await screen.findByLabelText("settings:notifications.smtpHost");
    expect(screen.queryByLabelText("settings:notifications.smtpPort")).toBeNull();
    expect(screen.queryByLabelText("settings:notifications.smtpFromName")).toBeNull();
    expect(screen.queryByText("settings:notifications.smtpSecure")).toBeNull();
    expect(screen.getByLabelText("settings:notifications.smtpFromEmail")).toBeInTheDocument();
    unmount();
    render(<SmtpManager expert />);
    expect(await screen.findByLabelText("settings:notifications.smtpPort")).toBeInTheDocument();
    expect(screen.getByLabelText("settings:notifications.smtpFromName")).toBeInTheDocument();
    expect(screen.getByText("settings:notifications.smtpSecure")).toBeInTheDocument();
  });
});

describe("Push", () => {
  it("Standard hides the relay address; Expert shows it", async () => {
    const { unmount } = render(<PushSettings expert={false} />);
    await screen.findByRole("checkbox", { name: "pushRelay:enable" });
    expect(screen.queryByLabelText("pushRelay:relayUrl")).toBeNull();
    unmount();
    render(<PushSettings expert />);
    expect(await screen.findByLabelText("pushRelay:relayUrl")).toBeInTheDocument();
  });
});

describe("WebDAV", () => {
  it("Standard hides the backup path; Expert shows it", async () => {
    const { unmount } = render(<WebDAVSettings expert={false} />);
    await waitFor(() => expect(screen.getByText("admin:webdav.subtitle")).toBeInTheDocument());
    expect(screen.queryByLabelText("admin:webdav.fields.backupPath.label")).toBeNull();
    unmount();
    render(<WebDAVSettings expert />);
    expect(
      await screen.findByLabelText("admin:webdav.fields.backupPath.label")
    ).toBeInTheDocument();
  });
});

describe("Template repository", () => {
  it("Standard shows where it reads from but no address field or test; Expert has both", async () => {
    const { unmount } = render(<TemplateRepoSettings expert={false} />);
    await screen.findByTestId("template-repo-effective");
    expect(screen.queryByLabelText("admin:templateRepo.url")).toBeNull();
    expect(screen.queryByRole("button", { name: "admin:templateRepo.test" })).toBeNull();
    unmount();
    render(<TemplateRepoSettings expert />);
    expect(await screen.findByLabelText("admin:templateRepo.url")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "admin:templateRepo.test" })).toBeInTheDocument();
  });
});

describe("Federation", () => {
  it("Standard hides a set address but still asks for a missing one (the switch needs it)", async () => {
    mocks.fedGet.mockResolvedValue(fed("https://me.example"));
    const set = render(<FederationSettings expert={false} />);
    await screen.findByLabelText("federation.enabled");
    expect(screen.queryByLabelText("federation.origin")).toBeNull();
    set.unmount();

    mocks.fedGet.mockResolvedValue(fed(null));
    const unset = render(<FederationSettings expert={false} />);
    expect(await screen.findByLabelText("federation.origin")).toBeInTheDocument();
    unset.unmount();

    mocks.fedGet.mockResolvedValue(fed("https://me.example"));
    render(<FederationSettings expert />);
    expect(await screen.findByLabelText("federation.origin")).toBeInTheDocument();
  });
});
