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
let tours = true;
vi.mock("../../../hooks/useToursVisible", () => ({ useToursVisible: () => tours }));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../../Settings/StravaConnectionCard", () => ({ default: () => <div>strava-card</div> }));
vi.mock("../../Settings/PhotoJourneyNightlyScanCard", () => ({ default: () => null }));
vi.mock("../../Settings/VisitPhotoImmichLink", () => ({ default: () => null }));
vi.mock("../ImmichModeRow", () => ({ default: () => null }));
vi.mock("../../Settings/DawarichProviderHint", () => ({ default: () => null }));

// The master internet switch (settings v3 S2): on unless a test says it is off.
let internetOff = false;
vi.mock("../../ServerPages/useInternetDependency", () => ({
  useInternetDependency: () =>
    internetOff
      ? { reason: "internet-off-reason", jump: { label: "internet-jump", onJump: () => {} } }
      : undefined,
}));

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
import { accountOverview, admin, adminOverview } from "./servicesFixtures";

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
    internetOff = false;
    vi.clearAllMocks();
    tours = true;
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

  it("an open card links to where a key is got: from the account's view, and from the admin's for the server", async () => {
    api.accountOverview.mockResolvedValue(
      accountOverview({
        ownKeys: [
          {
            ...accountOverview().ownKeys[0],
            id: "airlabs",
            getKeyUrl: "https://airlabs.co/account",
          },
        ],
      })
    );
    await show(false);
    const el = await open("airlabs");
    const link = el.querySelector("[data-key-link='airlabs'] a") as HTMLAnchorElement;
    expect(link.href).toBe("https://airlabs.co/account");
    expect(link.rel).toContain("noopener");
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
    expect(document.querySelectorAll("[data-service-card-id]:not([hidden])")).toHaveLength(5);
  });

  it("'only active or set-up services' hides the cards nothing is set up for, and is off by default", async () => {
    await show(true);
    await waitFor(() => expect(card("airlabs")).toBeTruthy(), WAIT);
    const all = document.querySelectorAll("[data-service-card-id]:not([hidden])").length;
    expect(all).toBe(SERVICE_CARDS.length);
    await userEvent.click(screen.getByLabelText("settingsRows:services.ui.onlyConfigured"));
    const shown = [...document.querySelectorAll("[data-service-card-id]:not([hidden])")].map((e) =>
      e.getAttribute("data-service-card-id")
    );
    expect(shown).toContain("airlabs");
    // Built-in "always on" services are not something the person set up.
    expect(shown).not.toContain("geocoder");
    expect(shown).not.toContain("aviationstack");
    expect(shown.length).toBeLessThan(all);
    expect(screen.queryByTestId("services-empty")).toBeNull();
  });

  it("a card the address names stays visible under the filter (search must not land on nothing)", async () => {
    plainRender(
      <MemoryRouter initialEntries={["/settings/services?service=aviationstack"]}>
        <ServicesPage isAdmin={true} />
      </MemoryRouter>
    );
    await waitFor(() => expect(card("aviationstack")).toBeTruthy(), WAIT);
    await userEvent.click(screen.getByLabelText("settingsRows:services.ui.onlyConfigured"));
    expect(card("aviationstack").hidden).toBe(false);
  });

  it("says so when the filter leaves no service, instead of drawing an empty page", async () => {
    api.accountOverview.mockResolvedValue(accountOverview({ connections: [], ownKeys: [] }));
    api.adminOverview.mockResolvedValue(adminOverview({ categories: [] }));
    await show(false);
    await waitFor(() => expect(card("airlabs")).toBeTruthy(), WAIT);
    expect(screen.queryByTestId("services-empty")).toBeNull();
    await userEvent.click(screen.getByLabelText("settingsRows:services.ui.onlyConfigured"));
    expect(document.querySelectorAll("[data-service-card-id]:not([hidden])")).toHaveLength(0);
    expect(screen.getByTestId("services-empty")).toBeInTheDocument();
  });

  it("switching group or closing a card does not throw away an unsaved key", async () => {
    await show(false);
    const el = await open("airlabs");
    const input = within(el).getByPlaceholderText("settings:blocks.secret.empty");
    await userEvent.type(input, "half-typed");
    await userEvent.click(screen.getByRole("button", { name: "settingsRows:services.groups.ki" }));
    await userEvent.click(
      screen.getByRole("button", { name: "settingsRows:services.groups.alle" })
    );
    expect(
      within(card("airlabs")).getByPlaceholderText("settings:blocks.secret.empty")
    ).toHaveValue("half-typed");
    await userEvent.click(within(card("airlabs")).getAllByRole("button")[0]);
    await userEvent.click(within(card("airlabs")).getAllByRole("button")[0]);
    expect(
      within(card("airlabs")).getByPlaceholderText("settings:blocks.secret.empty")
    ).toHaveValue("half-typed");
  });

  it("a secret that was sent is not sent again with the next save (a removed key does not come back)", async () => {
    api.accountUpdate.mockResolvedValue({});
    api.accountOverview.mockResolvedValue(
      accountOverview({
        connections: [
          {
            ...accountOverview().connections[0],
            fields: [
              { key: "baseUrl", kind: "url", value: "https://immich.lan", expert: false },
              { key: "apiKey", kind: "secret", value: null, masked: true, expert: false },
            ],
          },
        ],
      })
    );
    await show(false);
    const el = await open("immich");
    await userEvent.type(
      within(el).getByPlaceholderText("settings:blocks.secret.empty"),
      "first-key"
    );
    await userEvent.click(
      within(el).getByRole("button", { name: "settingsRows:services.ui.save" })
    );
    await waitFor(() => expect(api.accountUpdate).toHaveBeenCalledTimes(1), WAIT);
    const url = within(el).getByDisplayValue("https://immich.lan");
    await userEvent.type(url, "/api");
    await userEvent.click(
      within(el).getByRole("button", { name: "settingsRows:services.ui.save" })
    );
    await waitFor(() => expect(api.accountUpdate).toHaveBeenCalledTimes(2), WAIT);
    expect(api.accountUpdate.mock.calls[1][1]).toEqual({
      fields: { baseUrl: "https://immich.lan/api" },
    });
  });

  it("an admin without the tours beta still reaches the instance's routing keys; an account does not see them", async () => {
    tours = false;
    await show(false);
    await waitFor(() => expect(card("airlabs")).toBeTruthy(), WAIT);
    expect(card("openrouteservice")).toBeNull();
    cleanup();
    await show(true);
    await waitFor(() => expect(card("openrouteservice")).toBeTruthy(), WAIT);
    const el = await open("openrouteservice");
    expect(el.querySelector("[data-service-side='account']")).toBeNull();
    expect(el.querySelector("[data-service-side='server']")).toBeTruthy();
  });

  it("turning on a remote Ollama asks for the data-sharing confirmation and sends it with the write", async () => {
    api.adminOverview.mockResolvedValue(
      adminOverview({
        categories: [
          {
            id: "ai",
            services: [
              admin("ollama", {
                level: "instance",
                credential: "url",
                allowAccountKeys: null,
                consent: { allowedByAdmin: false, accountsConsented: 0 },
                fields: [{ key: "remoteOptIn", kind: "switch", value: false, expert: false }],
              }),
            ],
          },
        ],
      })
    );
    api.adminUpdate.mockResolvedValue({});
    await show(true);
    const el = await open("ollama");
    const srv = side(el, "server");
    const switches = within(srv).getAllByRole("switch");
    const remote = switches[switches.length - 1];
    await userEvent.click(remote);
    await userEvent.click(
      within(srv).getByRole("button", { name: "settingsRows:services.ui.saveAndTest" })
    );
    expect(api.adminUpdate).not.toHaveBeenCalled();
    await userEvent.click(await within(screen.getByRole("dialog")).findByRole("checkbox"));
    await userEvent.click(
      await screen.findByRole("button", { name: /externalServices:consent\.admin\.confirm/ })
    );
    await waitFor(
      () =>
        expect(api.adminUpdate).toHaveBeenCalledWith("ollama", {
          fields: { remoteOptIn: true },
          confirmDataSharing: true,
        }),
      WAIT
    );
  });

  describe("two pages since settings v3 S5", () => {
    async function showSide(side: "account" | "server"): Promise<void> {
      await act(async () => {
        render(<ServicesPage isAdmin={side === "server"} side={side} />);
      });
    }
    const ids = (): string[] =>
      [...document.querySelectorAll("[data-service-card-id]")].map(
        (el) => (el as HTMLElement).dataset.serviceCardId!
      );

    it("the account's page draws only the cards an account has something to do with, for an admin too", async () => {
      await act(async () => {
        render(<ServicesPage isAdmin={false} side="account" />);
      });
      await waitFor(() => expect(ids().length).toBeGreaterThan(0), WAIT);
      expect(ids()).toHaveLength(15);
      for (const id of ["gemini", "googlePlaces", "customLlm", "webdav"])
        expect(ids()).toContain(id);
      for (const id of ["adsbx", "aeroapi", "logos", "geocoder", "smtp"]) {
        expect(ids()).not.toContain(id);
      }
      expect(api.adminOverview).not.toHaveBeenCalled();
    });

    it("the server's page draws the prototype's grid in its groups, and the folded cards only at the expert level", async () => {
      useSettingsLevelStore.setState({ level: "standard" });
      await showSide("server");
      await waitFor(() => expect(ids().length).toBeGreaterThan(0), WAIT);
      expect(ids()).toHaveLength(21);
      for (const id of [
        "smtp",
        "push",
        "usageStats",
        "federation",
        "geocoder",
        "selfHostedRouting",
      ]) {
        expect(ids()).not.toContain(id);
      }
      for (const id of ["railTimetables", "openData", "fx", "updatesTemplates"]) {
        expect(ids()).not.toContain(id);
      }
      // The groups of the prototype, in its order.
      const headings = [...document.querySelectorAll("section[aria-label] > h3")].map(
        (h) => h.textContent
      );
      expect(headings).toEqual([
        "settingsRows:services.groups.flug",
        "settingsRows:services.groups.ki",
        "settingsRows:services.groups.foto",
        "settingsRows:services.groups.karte",
        "settingsRows:services.groups.sync",
      ]);
      cleanup();
      useSettingsLevelStore.setState({ level: "expert" });
      await showSide("server");
      await waitFor(() => expect(ids()).toHaveLength(25), WAIT);
      // Nothing of the account's half on the server's page.
      expect(document.querySelector("[data-service-side='account']")).toBeNull();
    });

    it("with the master internet switch off, the rows behind it are locked with the reason", async () => {
      internetOff = true;
      api.adminOverview.mockResolvedValue(
        adminOverview({
          categories: [
            {
              id: "openData",
              services: [
                admin("openData", { level: "instance", allowAccountKeys: null, fields: [] }),
                admin("railTimetables", {
                  level: "instance",
                  allowAccountKeys: null,
                  fields: [
                    { key: "transitous", kind: "switch", value: true, expert: false },
                    { key: "contact", kind: "text", value: "", expert: true },
                  ],
                }),
              ],
            },
          ],
        })
      );
      await showSide("server");
      const rail = await open("railTimetables");
      await waitFor(() => expect(within(rail).getByText("internet-off-reason")).toBeTruthy(), WAIT);
      // The switch cannot act; the address next to it can still be edited.
      const locked = rail.querySelector("[data-locked]") as HTMLElement;
      expect(locked).toBeTruthy();
      expect(within(rail).getAllByText("internet-off-reason")).toHaveLength(1);
      const dataSwitch = await open("openData");
      expect(within(dataSwitch).getByText("internet-off-reason")).toBeTruthy();
    });

    describe("own keys for Gemini and Google Places (settings v3 S2)", () => {
      const ownKey = (id: string) => ({
        id,
        recommended: null,
        effectiveSource: "none" as const,
        accountDisabled: false,
        configured: false,
        lastTest: null,
        fields: [
          { key: "apiKey", kind: "secret" as const, value: null, masked: true, expert: false },
        ],
      });
      const typeAndSave = async (el: HTMLElement, key: string): Promise<void> => {
        const mine = side(el, "account");
        await userEvent.type(
          within(mine).getByPlaceholderText("settings:blocks.secret.empty"),
          key
        );
        await userEvent.click(
          within(mine).getByRole("button", { name: "settingsRows:services.ui.saveAndTest" })
        );
      };

      it("Google Places takes the account's own key through the account endpoint, never the server's", async () => {
        api.accountOverview.mockResolvedValue(
          accountOverview({ ownKeys: [ownKey("googlePlaces")] })
        );
        api.accountUpdate.mockResolvedValue({});
        await showSide("account");
        await typeAndSave(await open("googlePlaces"), "places-key-1");
        await waitFor(
          () =>
            expect(api.accountUpdate).toHaveBeenCalledWith("googlePlaces", {
              fields: { apiKey: "places-key-1" },
            }),
          WAIT
        );
        expect(api.adminUpdate).not.toHaveBeenCalled();
      });

      it("Gemini holds the consent AND the own key, and the key goes to the account endpoint", async () => {
        api.accountOverview.mockResolvedValue(
          accountOverview({
            ownKeys: [ownKey("gemini")],
            aiConsents: [{ id: "gemini", consentedAt: null }] as never,
          })
        );
        api.accountUpdate.mockResolvedValue({});
        await showSide("account");
        const el = await open("gemini");
        // The consent row is still there: sending booking text is the account's decision.
        expect(
          within(side(el, "account")).getByText("settingsRows:services.tpl.aiConsent.t")
        ).toBeTruthy();
        await typeAndSave(el, "gem-key-9");
        await waitFor(
          () =>
            expect(api.accountUpdate).toHaveBeenCalledWith("gemini", {
              fields: { apiKey: "gem-key-9" },
            }),
          WAIT
        );
      });

      it("Gemini without an own key on offer (the admin forbade account keys) draws the consent alone", async () => {
        api.accountOverview.mockResolvedValue(
          accountOverview({ aiConsents: [{ id: "gemini", consentedAt: null }] as never })
        );
        await showSide("account");
        const el = await open("gemini");
        expect(
          within(side(el, "account")).queryByPlaceholderText("settings:blocks.secret.empty")
        ).toBeNull();
        expect(
          within(side(el, "account")).getByText("settingsRows:services.tpl.aiConsent.t")
        ).toBeTruthy();
      });

      it("an AI card that takes no own key (OpenAI) still draws the consent alone", async () => {
        api.accountOverview.mockResolvedValue(
          accountOverview({
            ownKeys: [ownKey("openai")],
            aiConsents: [{ id: "openai", consentedAt: null }] as never,
          })
        );
        await showSide("account");
        const el = await open("openai");
        expect(
          within(side(el, "account")).queryByPlaceholderText("settings:blocks.secret.empty")
        ).toBeNull();
      });
    });

    it("with the master internet switch on, nothing is locked", async () => {
      api.adminOverview.mockResolvedValue(
        adminOverview({
          categories: [
            {
              id: "openData",
              services: [
                admin("railTimetables", {
                  level: "instance",
                  allowAccountKeys: null,
                  fields: [{ key: "transitous", kind: "switch", value: true, expert: false }],
                }),
              ],
            },
          ],
        })
      );
      await showSide("server");
      const rail = await open("railTimetables");
      expect(within(rail).queryByText("internet-off-reason")).toBeNull();
    });
  });
});
