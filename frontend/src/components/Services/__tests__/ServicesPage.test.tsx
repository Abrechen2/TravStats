import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render as plainRender,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
vi.mock("../../../hooks/useToursVisible", () => ({ useToursVisible: () => true }));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../../Settings/StravaConnectionCard", () => ({ default: () => <div>strava-card</div> }));
vi.mock("../../Settings/PhotoJourneyNightlyScanCard", () => ({ default: () => null }));
vi.mock("../../Settings/VisitPhotoImmichLink", () => ({ default: () => null }));
vi.mock("../../Settings/DawarichProviderHint", () => ({ default: () => null }));

const api = vi.hoisted(() => ({
  adminOverview: vi.fn(),
  adminUpdate: vi.fn(),
  adminSetConnection: vi.fn(),
  adminTest: vi.fn(),
  accountOverview: vi.fn(),
  accountUpdate: vi.fn(),
  accountTest: vi.fn(),
  accountSetAiConsent: vi.fn(),
}));
vi.mock("../../../lib/api/externalServices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/externalServices")>()),
  externalServicesApi: api,
}));

import ServicesPage from "../ServicesPage";
import { SERVICE_CARDS } from "../serviceCards";
import { resetWriteQueue } from "../../ui/settings/writeQueue";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";
import { accountOverview, adminOverview } from "./servicesFixtures";

const render = (ui: ReactElement) => plainRender(<MemoryRouter>{ui}</MemoryRouter>);
const WAIT = { timeout: 3000 };
const card = (id: string): HTMLElement =>
  document.querySelector(`[data-service-card-id="${id}"]`) as HTMLElement;
const open = async (id: string): Promise<HTMLElement> => {
  const el = await waitFor(() => {
    const found = card(id);
    expect(found).toBeTruthy();
    return found;
  }, WAIT);
  await userEvent.click(within(el).getByRole("button", { name: /settings:blocks\.card|^/ }));
  return el;
};
const side = (el: HTMLElement, which: "account" | "server"): HTMLElement =>
  el.querySelector(`[data-service-side="${which}"]`) as HTMLElement;

async function show(isAdmin: boolean): Promise<void> {
  await act(async () => {
    render(<ServicesPage isAdmin={isAdmin} />);
  });
}

describe("ServicesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsLevelStore.setState({ level: "expert" });
    api.accountOverview.mockResolvedValue(accountOverview());
    api.adminOverview.mockResolvedValue(adminOverview());
  });
  afterEach(() => {
    cleanup();
    act(() => resetWriteQueue());
  });

  it("draws one card per catalogue entry — 31 — and asks the server's side of nobody but an admin", async () => {
    await show(false);
    await waitFor(
      () => expect(document.querySelectorAll("[data-service-card-id]")).toHaveLength(31),
      WAIT
    );
    expect(SERVICE_CARDS).toHaveLength(31);
    expect(api.adminOverview).not.toHaveBeenCalled();
  });

  it("an account sees no server controls, a status line instead", async () => {
    await show(false);
    await waitFor(() => expect(card("geocoder")).toBeTruthy(), WAIT);
    // A card with nothing for the account to set is a status, without a chevron.
    expect(card("geocoder").querySelector("[data-service-card='status']")).toBeTruthy();
    expect(document.querySelector("[data-service-side='server']")).toBeNull();
  });

  it("an admin's open card holds the account's part on top and the server's below, from separate calls", async () => {
    await show(true);
    const el = await open("airlabs");
    await waitFor(() => expect(side(el, "server")).toBeTruthy(), WAIT);
    const html = el.innerHTML;
    expect(html.indexOf('data-service-side="account"')).toBeLessThan(
      html.indexOf('data-service-side="server"')
    );
    expect(api.accountOverview).toHaveBeenCalledTimes(1);
    expect(api.adminOverview).toHaveBeenCalledTimes(1);
  });

  it("an own key goes to the account endpoint only, never to the server's", async () => {
    api.accountUpdate.mockResolvedValue({});
    await show(true);
    const el = await open("airlabs");
    const mine = side(el, "account");
    await userEvent.type(
      within(mine).getByPlaceholderText("settings:blocks.secret.empty"),
      "my-key-123"
    );
    await userEvent.click(
      within(mine).getByRole("button", { name: "settingsRows:services.ui.saveAndTest" })
    );
    await waitFor(
      () =>
        expect(api.accountUpdate).toHaveBeenCalledWith("airlabs", {
          fields: { apiKey: "my-key-123" },
        }),
      WAIT
    );
    expect(api.adminUpdate).not.toHaveBeenCalled();
  });

  it("a server key goes to the server endpoint only, and a stored one is kept when the field stays empty", async () => {
    api.adminUpdate.mockResolvedValue({});
    api.adminTest.mockResolvedValue({ ok: true, reason: null, usedQuota: true, lastTest: null });
    await show(true);
    const el = await open("airlabs");
    const srv = side(el, "server");
    const save = within(srv).getByRole("button", { name: "settingsRows:services.ui.saveAndTest" });
    expect(save).toBeDisabled();
    await userEvent.type(
      within(srv).getByPlaceholderText("settings:blocks.secret.set"),
      "new-server-key"
    );
    await userEvent.click(save);
    await waitFor(
      () =>
        expect(api.adminUpdate).toHaveBeenCalledWith("airlabs", {
          fields: { apiKey: "new-server-key" },
        }),
      WAIT
    );
    expect(api.accountUpdate).not.toHaveBeenCalled();
  });

  it("a refused own key keeps what was typed and says why — the admin forbade it", async () => {
    api.accountUpdate.mockRejectedValue({
      response: { status: 403, data: { error: "x", code: "ACCOUNT_KEYS_NOT_ALLOWED" } },
    });
    await show(false);
    const el = await open("airlabs");
    const input = within(el).getByPlaceholderText("settings:blocks.secret.empty");
    await userEvent.type(input, "typed-key");
    await userEvent.click(
      within(el).getByRole("button", { name: "settingsRows:services.ui.saveAndTest" })
    );
    expect(
      await within(el).findByText(
        "externalServices:errors.ACCOUNT_KEYS_NOT_ALLOWED",
        undefined,
        WAIT
      )
    ).toBeInTheDocument();
    expect(input).toHaveValue("typed-key");
    expect(within(el).getByText(/settings:blocks\.save\.failed/)).toBeInTheDocument();
  });

  it("a refused server write is said on the card and keeps the draft", async () => {
    api.adminUpdate.mockRejectedValue({
      response: { status: 400, data: { error: "x", code: "VALIDATION_FAILED" } },
    });
    await show(true);
    const el = await open("airlabs");
    const srv = side(el, "server");
    const input = within(srv).getByPlaceholderText("settings:blocks.secret.set");
    await userEvent.type(input, "bad");
    await userEvent.click(
      within(srv).getByRole("button", { name: "settingsRows:services.ui.saveAndTest" })
    );
    expect(
      await within(srv).findByText("externalServices:errors.VALIDATION_FAILED", undefined, WAIT)
    ).toBeInTheDocument();
    expect(input).toHaveValue("bad");
  });

  it("the server's switch keeps the admin's pick when the write is refused, and offers a retry", async () => {
    api.adminUpdate.mockRejectedValueOnce(new Error("Network Error")).mockResolvedValue({});
    await show(true);
    const el = await open("airlabs");
    const srv = side(el, "server");
    const toggle = within(srv).getAllByRole("switch")[0];
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await userEvent.click(toggle);
    expect(
      await within(srv).findByText(/settings:blocks\.save\.failed/, undefined, WAIT)
    ).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await userEvent.click(within(srv).getByRole("button", { name: "settings:blocks.save.retry" }));
    await waitFor(() => expect(api.adminUpdate).toHaveBeenCalledTimes(2), WAIT);
    expect(api.adminUpdate).toHaveBeenLastCalledWith("airlabs", { enabled: false });
  });

  it("tells why a service is missing from the account's own lists, from the server's answer", async () => {
    api.accountOverview.mockResolvedValue(
      accountOverview({ ownKeys: [], blocked: [{ id: "airlabs", reason: "keysForbidden" }] })
    );
    await show(false);
    const el = await open("airlabs");
    expect(within(el).getByText("settingsRows:services.tpl.allowKeys.us")).toBeInTheDocument();
  });

  it("a test shows what the tester answered — a rejected key in words, never a made-up success", async () => {
    api.accountOverview.mockResolvedValue(
      accountOverview({
        ownKeys: [
          {
            ...accountOverview().ownKeys[0],
            effectiveSource: "account",
            configured: true,
            fields: [
              { key: "apiKey", kind: "secret", value: "•••• 1111", masked: true, expert: false },
            ],
          },
        ],
      })
    );
    api.accountTest.mockResolvedValue({
      ok: false,
      reason: "auth",
      usedQuota: false,
      lastTest: null,
    });
    await show(false);
    const el = await open("airlabs");
    await userEvent.click(
      within(el).getByRole("button", { name: "settingsRows:services.tpl.test.btn" })
    );
    expect(
      await within(el).findByText(/settingsRows:services\.reason\.auth/, undefined, WAIT)
    ).toBeInTheDocument();
    expect(within(el).queryByText(/test\.resultOk/)).toBeNull();
  });

  it("a test that cannot run says so; it does not pass", async () => {
    api.adminTest.mockRejectedValue(new Error("Network Error"));
    await show(true);
    const el = await open("airlabs");
    const srv = side(el, "server");
    await userEvent.click(
      within(srv).getByRole("button", { name: "settingsRows:services.tpl.test.btn" })
    );
    expect(
      await within(srv).findByText("settingsRows:services.ui.testCouldNotRun", undefined, WAIT)
    ).toBeInTheDocument();
  });

  it("a switched-off service answers its test with the 'I don't ask' sentence", async () => {
    api.adminTest.mockRejectedValue({
      response: { status: 409, data: { code: "SERVICE_DISABLED" } },
    });
    await show(true);
    const el = await open("airlabs");
    const srv = side(el, "server");
    await userEvent.click(
      within(srv).getByRole("button", { name: "settingsRows:services.tpl.test.btn" })
    );
    expect(
      await within(srv).findByText(/settingsRows:services\.reason\.disabled/, undefined, WAIT)
    ).toBeInTheDocument();
  });

  it("agreeing to cloud AI waits for the admin: without a release the row says so and cannot be pressed", async () => {
    await show(false);
    const el = await open("openai");
    expect(within(el).getByText("settings:blocks.dep.aiNotAllowed.reason")).toBeInTheDocument();
    expect(
      within(el).getByRole("button", { name: "settingsRows:services.tpl.aiConsent.btn" })
    ).toBeDisabled();
  });

  it("a services list that fails to load says so and offers a retry that asks again", async () => {
    api.accountOverview.mockRejectedValueOnce(new Error("Network Error"));
    await show(false);
    expect(
      await screen.findByText("settingsRows:services.ui.loadFailed", undefined, WAIT)
    ).toBeInTheDocument();
    api.accountOverview.mockResolvedValue(accountOverview());
    await userEvent.click(screen.getByRole("button", { name: "settingsRows:services.ui.retry" }));
    await waitFor(() => expect(card("airlabs")).toBeTruthy(), WAIT);
  });

  it("an always-on service shows no off switch to the admin", async () => {
    await show(true);
    const el = await open("geocoder");
    const srv = side(el, "server");
    expect(within(srv).queryAllByRole("switch")).toHaveLength(0);
    expect(within(srv).getByText("settingsRows:services.status.always")).toBeInTheDocument();
  });

  it.each(["airlabs", "immich", "openData", "railTimetables"])(
    "the %s card says what happens when the service does not answer (forgejo#88)",
    async (id) => {
      // An account without anything to set on a server-only card sees its status alone.
      await show(true);
      const el = await open(id);
      expect(el.querySelector(`[data-unreachable-note="${id}"]`)).toBeTruthy();
    }
  );

  it("groups: choosing one shows only its cards", async () => {
    await show(false);
    await waitFor(() => expect(card("airlabs")).toBeTruthy(), WAIT);
    await userEvent.click(screen.getByRole("button", { name: "settingsRows:services.groups.ki" }));
    expect(document.querySelectorAll("[data-service-card-id]")).toHaveLength(5);
  });
});
