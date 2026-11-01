import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render as plainRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && !("defaultValue" in options) ? `${key} ${JSON.stringify(options)}` : key,
    i18n: undefined,
  }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../../Admin/AirlineLogoRefreshButton", () => ({ default: () => null }));

const mocks = vi.hoisted(() => ({
  testSmtp: vi.fn(),
  deleteSmtp: vi.fn(),
  adminUpdate: vi.fn(),
  pushGet: vi.fn(),
  pushUpdate: vi.fn(),
  pushReset: vi.fn(),
  usageGet: vi.fn(),
  usageSet: vi.fn(),
  dawGet: vi.fn(),
  dawUpdate: vi.fn(),
  dawTest: vi.fn(),
  dawSweep: vi.fn(),
  wdGet: vi.fn(),
  wdUpdate: vi.fn(),
  ollamaList: vi.fn(),
  ollamaPull: vi.fn(),
}));
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  adminApi: {
    testSmtpConnection: mocks.testSmtp,
    deleteSmtpConfig: mocks.deleteSmtp,
    listOllamaModels: mocks.ollamaList,
    pullOllamaModel: mocks.ollamaPull,
  },
  pushRelayApi: { get: mocks.pushGet, update: mocks.pushUpdate, reset: mocks.pushReset },
  usageStatsApi: { get: mocks.usageGet, setConsent: mocks.usageSet },
}));
vi.mock("../../../lib/api/externalServices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/externalServices")>()),
  externalServicesApi: { adminUpdate: mocks.adminUpdate },
}));
vi.mock("../../../lib/api/dawarich", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/dawarich")>()),
  dawarichAdminApi: {
    getSettings: mocks.dawGet,
    updateSettings: mocks.dawUpdate,
    testConnection: mocks.dawTest,
    sweepNow: mocks.dawSweep,
  },
}));
vi.mock("../../../lib/api/webdavSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/webdavSync")>()),
  webdavSyncApi: { get: mocks.wdGet, update: mocks.wdUpdate },
}));

import SmtpRows, { smtpTestCode } from "../SmtpRows";
import PushRows from "../PushRows";
import UsageStatsRows from "../UsageStatsRows";
import DawarichServerRows from "../DawarichServerRows";
import WebdavAccountRows from "../WebdavAccountRows";
import OllamaRows from "../OllamaRows";
import { ServicesProvider } from "../servicesContext";
import { resetWriteQueue } from "../../ui/settings/writeQueue";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";
import { admin } from "./servicesFixtures";

const WAIT = { timeout: 3000 };
const show = async (ui: ReactElement): Promise<void> => {
  await act(async () => {
    plainRender(
      <MemoryRouter>
        <ServicesProvider isAdmin={false}>{ui}</ServicesProvider>
      </MemoryRouter>
    );
  });
};

const smtp = admin("smtp", {
  level: "instance",
  credential: "smtp",
  allowAccountKeys: null,
  fields: [
    { key: "host", kind: "text", value: "mail.example.org", expert: false },
    { key: "port", kind: "number", value: 587, expert: true },
    { key: "secure", kind: "switch", value: false, expert: true },
    { key: "username", kind: "text", value: "travstats", expert: false },
    { key: "password", kind: "secret", value: "•••• 1234", masked: true, expert: false },
    { key: "fromEmail", kind: "text", value: "reise@example.org", expert: false },
    { key: "fromName", kind: "text", value: "TravStats", expert: true },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsLevelStore.setState({ level: "expert" });
});
afterEach(() => {
  cleanup();
  act(() => resetWriteQueue());
});

describe("SmtpRows", () => {
  it.each([
    ["SMTP_AUTH"],
    ["SMTP_TLS"],
    ["SMTP_CONNECTION"],
    ["SMTP_TIMEOUT"],
    ["SMTP_PASSWORD_MISSING"],
  ])(
    "says the %s failure of the test in its own sentence, and never the server's text",
    async (code) => {
      mocks.testSmtp.mockRejectedValue({
        response: {
          status: 400,
          data: { success: false, code, error: "535 5.7.8 alice@secret.example" },
        },
      });
      await show(<SmtpRows service={smtp} />);
      await userEvent.click(
        screen.getByRole("button", { name: "settingsRows:services.rows.smtptest.btn" })
      );
      expect(
        await screen.findByText(`settingsRows:services.smtp.${code}`, undefined, WAIT)
      ).toBeInTheDocument();
      expect(document.body.textContent).not.toContain("alice@secret.example");
    }
  );

  it("reads a failure with no code as the unknown one, not as the transport's message", () => {
    expect(smtpTestCode({ response: { data: { error: "raw nodemailer text" } } })).toBe(
      "SMTP_UNKNOWN"
    );
    expect(smtpTestCode(new Error("boom"))).toBe("SMTP_UNKNOWN");
  });

  it("tests with the stored password when none is typed: the request carries no password", async () => {
    mocks.testSmtp.mockResolvedValue({ success: true });
    await show(<SmtpRows service={smtp} />);
    await userEvent.click(
      screen.getByRole("button", { name: "settingsRows:services.rows.smtptest.btn" })
    );
    await waitFor(() => expect(mocks.testSmtp).toHaveBeenCalled(), WAIT);
    expect(mocks.testSmtp.mock.calls[0][0]).not.toHaveProperty("password");
    expect(
      await screen.findByText("settingsRows:services.ui.smtpOk", undefined, WAIT)
    ).toBeInTheDocument();
  });

  it("deleting the credentials goes through the confirmation, and says when it fails", async () => {
    mocks.deleteSmtp.mockRejectedValue(new Error("Network Error"));
    await show(<SmtpRows service={smtp} />);
    await userEvent.click(
      screen.getByRole("button", { name: "settingsRows:services.rows.smtpdel.btn" })
    );
    expect(mocks.deleteSmtp).not.toHaveBeenCalled();
    await userEvent.click(
      await screen.findByRole("button", { name: "settingsRows:services.dialogs.smtpdel.confirm" })
    );
    expect(
      await screen.findByText("settingsRows:services.ui.deleteFailed", undefined, WAIT)
    ).toBeInTheDocument();
  });
});

describe("PushRows", () => {
  const state = {
    pushEnabled: false,
    pushRelayUrl: "https://push.travstats.de",
    registered: false,
    pausedUntil: null,
    consentAt: null,
  };

  it("says when the state cannot be read instead of offering a switch over it", async () => {
    mocks.pushGet.mockRejectedValue(new Error("Network Error"));
    await show(<PushRows />);
    expect(await screen.findByText("pushRelay:loadFailed", undefined, WAIT)).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("keeps the admin's pick when switching it on is refused", async () => {
    mocks.pushGet.mockResolvedValue(state);
    mocks.pushUpdate.mockRejectedValue(new Error("Network Error"));
    await show(<PushRows />);
    const toggle = await screen.findByRole("switch");
    await userEvent.click(toggle);
    expect(
      await screen.findByText(/settings:blocks\.save\.failed/, undefined, WAIT)
    ).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("shows the consent text next to the switch, before it is turned on", async () => {
    mocks.pushGet.mockResolvedValue(state);
    await show(<PushRows />);
    expect(await screen.findByText("pushRelay:explanation.receives")).toBeInTheDocument();
  });

  it("names a refused relay address", async () => {
    mocks.pushGet.mockResolvedValue(state);
    mocks.pushUpdate.mockRejectedValue({ response: { status: 400 } });
    await show(<PushRows />);
    const field = await screen.findByDisplayValue("https://push.travstats.de");
    await userEvent.clear(field);
    await userEvent.type(field, "http://nope.example");
    await userEvent.tab();
    expect(await screen.findByText("pushRelay:invalidUrl", undefined, WAIT)).toBeInTheDocument();
  });

  it("says when the reset fails and keeps the dialog open", async () => {
    mocks.pushGet.mockResolvedValue({ ...state, registered: true });
    mocks.pushReset.mockRejectedValue(new Error("Network Error"));
    await show(<PushRows />);
    await userEvent.click(
      await screen.findByRole("button", { name: "settingsRows:services.rows.pushreset.btn" })
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "settingsRows:services.dialogs.pushreset.confirm" })
    );
    expect(
      await screen.findByText("settingsRows:services.ui.resetFailed", undefined, WAIT)
    ).toBeInTheDocument();
  });
});

describe("UsageStatsRows", () => {
  it("says when the state cannot be read", async () => {
    mocks.usageGet.mockRejectedValue(new Error("Network Error"));
    await show(<UsageStatsRows />);
    expect(
      await screen.findByText("settingsRows:services.ui.loadFailed", undefined, WAIT)
    ).toBeInTheDocument();
  });

  it("a question not yet answered is 'not asked', not 'no'", async () => {
    mocks.usageGet.mockResolvedValue({
      consent: "unset",
      installId: null,
      endpointConfigured: true,
    });
    await show(<UsageStatsRows />);
    expect(await screen.findByText("settingsRows:services.status.notAsked")).toBeInTheDocument();
  });

  it("keeps the answer when it is refused", async () => {
    mocks.usageGet.mockResolvedValue({
      consent: "denied",
      installId: null,
      endpointConfigured: true,
    });
    mocks.usageSet.mockRejectedValue(new Error("Network Error"));
    await show(<UsageStatsRows />);
    await userEvent.click(
      await screen.findByRole("radio", { name: "settingsRows:services.rows.nutzstat.o.1" })
    );
    expect(
      await screen.findByText(/settings:blocks\.save\.failed/, undefined, WAIT)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "settingsRows:services.rows.nutzstat.o.1" })
    ).toHaveAttribute("aria-checked", "true");
  });
});

describe("DawarichServerRows", () => {
  it("sends only what was typed: a key left empty is not sent, so the stored one stays", async () => {
    mocks.dawGet.mockResolvedValue({ baseUrl: "https://dawarich.lan", apiKey: "••••" });
    mocks.dawUpdate.mockResolvedValue({ baseUrl: "https://dawarich.example", apiKey: "••••" });
    await show(<DawarichServerRows />);
    const url = await screen.findByDisplayValue("https://dawarich.lan");
    await userEvent.clear(url);
    await userEvent.type(url, "https://dawarich.example");
    await userEvent.click(screen.getByRole("button", { name: "settingsRows:services.ui.save" }));
    await waitFor(() => expect(mocks.dawUpdate).toHaveBeenCalled(), WAIT);
    expect(mocks.dawUpdate.mock.calls[0][0]).toEqual({ baseUrl: "https://dawarich.example" });
  });

  it("says an unreachable server in words and does not pass the test", async () => {
    mocks.dawGet.mockResolvedValue({ baseUrl: "https://dawarich.lan", apiKey: "••••" });
    mocks.dawTest.mockRejectedValue({ response: { data: { error: "unreachable" } } });
    await show(<DawarichServerRows />);
    await userEvent.click(
      await screen.findByRole("button", { name: "settingsRows:services.tpl.test.btn" })
    );
    expect(
      await screen.findByText(/settingsRows:services\.reason\.network/, undefined, WAIT)
    ).toBeInTheDocument();
  });

  it("says when the sweep outcome is not known", async () => {
    mocks.dawGet.mockResolvedValue({ baseUrl: "https://dawarich.lan", apiKey: "••••" });
    const { JobLostError } = await import("../../../lib/api/jobs");
    mocks.dawSweep.mockRejectedValue(new JobLostError());
    await show(<DawarichServerRows />);
    await userEvent.click(
      await screen.findByRole("button", { name: "settingsRows:services.rows.dawsweep.btn" })
    );
    expect(
      await screen.findByText("settingsRows:services.ui.sweepLost", undefined, WAIT)
    ).toBeInTheDocument();
  });
});

describe("WebdavAccountRows", () => {
  const status = {
    enabled: false,
    url: "https://cloud.example.com/dav",
    username: "me",
    hasPassword: true,
    remotePath: "/TravStats/",
    schedule: "daily",
    keepVersions: 5,
    ranAt: null,
    completedAt: null,
    lastStatus: null,
    lastErrorCode: null,
    lastFileName: null,
    lastSizeBytes: null,
    running: false,
    allowPrivateTargets: false,
  };

  it("never puts the stored password into the form", async () => {
    mocks.wdGet.mockResolvedValue(status);
    await show(<WebdavAccountRows />);
    const field = await screen.findByPlaceholderText("settings:blocks.secret.set");
    expect(field).toHaveValue("");
  });

  it("says why a connection save was refused — a LAN share for an ordinary account — and sends no password", async () => {
    mocks.wdGet.mockResolvedValue(status);
    mocks.wdUpdate.mockRejectedValue({
      response: { status: 400, data: { error: "blockedTarget" } },
    });
    await show(<WebdavAccountRows />);
    const url = await screen.findByDisplayValue("https://cloud.example.com/dav");
    await userEvent.clear(url);
    await userEvent.type(url, "http://192.168.1.5/dav");
    await userEvent.click(screen.getByRole("button", { name: "settingsRows:services.ui.save" }));
    expect(
      await screen.findByText("settings:webdavSync.errors.blockedTarget", undefined, WAIT)
    ).toBeInTheDocument();
    expect(mocks.wdUpdate.mock.calls[0][0]).not.toHaveProperty("password");
  });
});

describe("OllamaRows", () => {
  const ollama = admin("ollama", {
    level: "instance",
    credential: "url",
    fields: [{ key: "url", kind: "url", value: "http://ollama.lan:11434", expert: true }],
  });

  it("says when the model list cannot be had instead of an empty list", async () => {
    mocks.ollamaList.mockRejectedValue(new Error("Network Error"));
    await show(<OllamaRows service={ollama} />);
    expect(
      await screen.findByText("settingsRows:services.ui.modelsUnknown", undefined, WAIT)
    ).toBeInTheDocument();
  });

  it("says a refused pull in words and does not claim the model is there", async () => {
    mocks.ollamaList.mockResolvedValue({ success: true, models: [] });
    mocks.ollamaPull.mockResolvedValue({
      success: false,
      error: "pull model manifest: file does not exist",
    });
    await show(<OllamaRows service={ollama} />);
    await userEvent.type(await screen.findByPlaceholderText("llama3.1:8b"), "nope:1b");
    await userEvent.click(
      screen.getByRole("button", { name: "settingsRows:services.rows.ollpull.btn" })
    );
    expect(
      await screen.findByText("settingsRows:services.ui.pullFailed", undefined, WAIT)
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("manifest");
  });
});
