import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// The services page asks the parser whether a model is there (forgejo#321);
// not the subject here.
vi.mock("../../hooks/useHasLlm", () => ({ useHasLlm: () => null, resetHasLlmCache: () => {} }));
// The page asks where the account's location comes from (the TravTrack area stays
// for an account on Dawarich alone, settings v3 S4); not the subject here.
vi.mock("@/lib/api/locationProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/locationProvider")>()),
  locationProviderApi: {
    get: vi.fn().mockResolvedValue({
      kind: "none",
      rev: 0,
      status: "ok",
      choices: { none: true, travtrack: false, dawarich: false },
    }),
    set: vi.fn(),
  },
}));
// The version line under the settings menu asks the server (forgejo#321).
vi.mock("@/lib/api/version", () => ({
  versionApi: { get: vi.fn().mockResolvedValue({ version: "2.7.0", buildVersion: "2.7.0" }) },
}));

import { render, within, waitFor, act, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SettingsPage from "../SettingsPage";
import { DEEP_LINK_ALIGN_BUDGET_MS } from "../Admin/useDeepLinkScroll";
import { LazyBody } from "../Admin/LazySection";
import {
  installFakeIntersectionObserver,
  type FakeIntersectionObserverHandle,
} from "../Admin/__tests__/intersectionObserverStub";
import {
  installFakeResizeObserver,
  type FakeResizeObserverHandle,
} from "../Admin/__tests__/resizeObserverStub";
import { findNamed, getNamed } from "../../__tests__/helpers/namedElement";
import { useSettingsLevelStore } from "../../store/settingsLevelStore";
import { repeatedHeadings } from "../../__tests__/helpers/repeatedHeadings";
import { AREA_PAGES } from "../Settings/area/areaModel";
import { resetInstanceStore } from "../../components/ServerPages/instanceStore";

/**
 * Round 4 ("one page, anchor jumps" — tester feedback): the admin page used to
 * hold every section's data but mount only the ONE picked by `activeSection`
 * state, swapping the whole `<main>` out on every click. Since forgejo#321 a
 * menu entry is a page and a page's sections are anchors on it, drawn as
 * chips: every section of the page renders at once, and the chips are anchors
 * rather than buttons that pick which single section is mounted.
 */

// AppShell always renders NavigationBar, which asks for the running version
// on mount — unmocked, that is a real, always-failing XHR in jsdom
// (forgejo#110's exact shape). SettingsPage's own tests stub it the same way.
vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-bar-stub" />,
}));

// The four "eager" sections (system, users, invitations, parsers) are the
// ones AdminPage already loads unconditionally today via loadData()'s
// Promise.all, regardless of which section is picked — that has not
// changed here. Every other general-tab section (instance, backups, smtp,
// externalServices, logging) is wrapped in LazySection, and in jsdom there
// is no IntersectionObserver, so those sections' real content deliberately
// never mounts (see LazySection's doc comment) — nothing beyond these four
// endpoints needs mocking for this file's assertions.
// The parsers page's template repository section is a status summary now
// (settings redesign, package 5): it reads the services overview on mount.
// The instance mailbox card loads its own settings; it has its own tests.
vi.mock("../../components/MailIntake/MailIntakeAdminCard", () => ({ default: () => null }));
vi.mock("@/lib/api/externalServices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/externalServices")>()),
  externalServicesApi: {
    adminOverview: vi.fn().mockResolvedValue({ categories: [], accountConnections: [] }),
    accountOverview: vi.fn().mockResolvedValue({
      connections: [],
      ownKeys: [],
      aiConsents: [],
      instanceProvided: [],
      blocked: [],
    }),
  },
}));

// Sign-in page pictures are listed on the Server page.
vi.mock("@/lib/api/loginBackgrounds", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/loginBackgrounds")>()),
  getLoginBackgrounds: vi.fn().mockResolvedValue([]),
}));

// The time-model report asks the server what the migration did.
vi.mock("@/lib/api/timeMigration", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/timeMigration")>()),
  timeMigrationApi: {
    getReport: vi.fn().mockRejectedValue(new Error("not under test")),
  },
}));

// The open federation card reads this server's identity.
vi.mock("@/lib/api/federationAdmin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/federationAdmin")>()),
  federationAdminApi: {
    get: vi.fn().mockResolvedValue({
      source: "settings",
      enabled: false,
      origin: null,
      publicKey: null,
      fingerprint: null,
      hasKey: false,
      tripSharingEnabled: false,
      peers: [],
    }),
  },
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    // Datenschutz reads the statistics consent and the push registration on mount.
    usageStatsApi: {
      ...actual.usageStatsApi,
      get: vi.fn().mockResolvedValue({ consent: null, endpointConfigured: true, installId: null }),
    },
    pushRelayApi: {
      ...actual.pushRelayApi,
      get: vi.fn().mockResolvedValue({
        pushEnabled: false,
        pushRelayUrl: "https://push.example",
        registered: false,
        pausedUntil: null,
        consentAt: null,
      }),
    },
    backupApi: {
      ...actual.backupApi,
      list: vi.fn().mockResolvedValue({ backups: [] }),
      getStatus: vi.fn().mockResolvedValue({ running: false, currentBackup: null }),
      getBackupSettings: vi.fn().mockResolvedValue({
        backupEnabled: false,
        backupInterval: "weekly",
        backupRetentionDays: 30,
      }),
    },
    adminApi: {
      ...actual.adminApi,
      getSystemInfo: vi.fn().mockResolvedValue({
        instanceName: "TravStats",
        userCount: 1,
        activeUserCount: 1,
        flightCount: 0,
        maxUsers: 10,
        warningThreshold: false,
        registrationEnabled: false,
        version: "0.0.0-test",
        buildVersion: "0.0.0-test",
      }),
      getUsers: vi.fn().mockResolvedValue({ users: [] }),
      getInstanceSettings: vi.fn().mockResolvedValue({
        settings: {
          instanceName: "TravStats",
          maxUsers: 10,
          allowRegistration: false,
          betaFeaturesEnabled: false,
          frontendUrl: "https://trav.example",
          publicUrl: null,
          lanUrl: null,
          webauthnRpId: null,
          webauthnOrigins: [],
          countryThreshold: "transited",
        },
        passkeyStatus: { usable: false, reason: "notConfigured" },
      }),
      getImportMode: vi.fn().mockResolvedValue({ until: null, userId: null, hours: 24 }),
      getSmtpConfig: vi.fn().mockResolvedValue({ configured: false }),
      getWebDAVSettings: vi.fn().mockResolvedValue({ settings: { enabled: false } }),
      getInvitations: vi.fn().mockResolvedValue({ invitations: [] }),
      getAdminParserSettings: vi.fn().mockResolvedValue({
        allowUserApiKeys: false,
        fxCdnFallbackEnabled: false,
        defaultVisionParser: "template",
        defaultTextParser: "template",
        ollamaUrl: null,
        ollamaModel: null,
      }),
      // Only reached once a lazy section's IntersectionObserver reports it
      // visible — the "lazy section reveal" describe block below is the only
      // place these get called at all.
      getLoggingConfig: vi.fn().mockResolvedValue({ logLevel: "info" }),
      getLogFiles: vi.fn().mockResolvedValue({ files: [] }),
      getLogStats: vi.fn().mockResolvedValue({ totalSize: 0, fileCount: 0 }),
    },
  };
});

// The personal state is not the subject: the account is an admin.
vi.mock("../../components/Settings/useSettingsPage", () => ({
  useSettingsPage: () => ({
    user: { username: "owner", isAdmin: true },
    showPasswordModal: false,
    autoSaveState: "idle",
  }),
}));

const renderAdmin = (entry = "/settings/allgemein") =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/:page" element={<SettingsPage />} />
        <Route path="/admin" element={<SettingsPage />} />
        <Route path="/admin/:page" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>
  );

/** The Server page's first section; awaiting it means the page has rendered. */
const INSTANCE = "settingsRows:server.sections.yourServer";

describe("SettingsPage, the server's pages — one page per menu entry, its sections as anchors", () => {
  beforeEach(() => {
    // jsdom has no scrollIntoView at all; SettingsPage guards for its
    // absence at runtime, but pinning the deep-link behaviour needs a spy.
    Element.prototype.scrollIntoView = vi.fn();
    // These tests walk every section, expert ones included.
    useSettingsLevelStore.setState({ level: "expert" });
  });
  afterEach(() => {
    cleanup();
    useSettingsLevelStore.setState({ level: null });
  });

  it("renders every section of the page at once, not only one picked section", async () => {
    renderAdmin();

    // Two distinct sections of the General page at once: a page that mounted
    // one picked section cannot pass this whichever one it picked.
    expect(await findNamed("region", INSTANCE)).toBeInTheDocument();
    expect(getNamed("region", "settingsRows:users.sections.access")).toBeInTheDocument();
  });

  // Acceptance 2026-09-26: the page nested its own <main> inside AppShell's —
  // two main landmarks, which a screen reader announces as two pages.
  it("has exactly one main landmark", async () => {
    const { container } = renderAdmin();
    await findNamed("region", INSTANCE);
    expect(container.querySelectorAll("main")).toHaveLength(1);
  });

  it("gives every section landmark its settings-<id> anchor id, lazy sections included", async () => {
    renderAdmin();
    await findNamed("region", INSTANCE);

    for (const id of ["general", "access"]) {
      expect(document.getElementById(`settings-${id}`)).not.toBeNull();
    }
  });

  it("draws the page's sections as anchor chips, and the menu as links to pages", async () => {
    renderAdmin();
    await findNamed("region", INSTANCE);

    const chips = getNamed("navigation", "settings:sectionChips");
    const anchors = within(chips).getAllByRole("link");
    expect(anchors.map((a) => a.getAttribute("href"))).toContain("#settings-access");
    expect(anchors.map((a) => a.getAttribute("href"))).toContain("#settings-general");
    // The old column picked a section with a button; none should remain here.
    expect(within(chips).queryAllByRole("button")).toHaveLength(0);

    const menu = document.querySelector("[data-settings-menu] nav") as HTMLElement;
    const pages = within(menu)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(pages).toContain("/settings/nutzer");
    expect(pages).toContain("/settings/wartung");
    expect(pages).toContain("/settings/adressen");
    expect(pages).toContain("/settings/eigene");
    expect(pages).toContain("/settings/email");
    expect(pages).toContain("/settings/dienste");
    expect(within(menu).queryAllByRole("button")).toHaveLength(0);
  }, 20_000); // renders the whole server area; over 5 s under a full parallel run

  it("scrolls a ?section= deep link into view once the page has rendered", async () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;

    renderAdmin("/settings/funktionen?match=importmodus#features");
    await findNamed("region", "settingsRows:server.sections.features");

    await waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1));
    expect(scrollSpy.mock.instances[0]).toBe(document.getElementById("settings-features"));
  });

  it("does not scroll anywhere without a section in the address", async () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;

    renderAdmin("/settings/allgemein");
    await findNamed("region", INSTANCE);

    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("lands a pre-page /admin ?section= link on the page that holds it now", async () => {
    renderAdmin("/admin?tab=general&section=users");
    expect(await findNamed("region", "settingsRows:users.sections.accounts")).toBeInTheDocument();
    expect(document.querySelector("h1")).toHaveTextContent("settings:area.pages.nutzer");
  });
});

describe("SettingsPage, the server's pages — the missing public address (B15)", () => {
  beforeEach(async () => {
    Element.prototype.scrollIntoView = vi.fn();
    resetInstanceStore();
  });
  afterEach(() => cleanup());

  it("warns on the Server page and at its menu entry while the public address is empty", async () => {
    const { adminApi } = await import("@/lib/api");
    vi.mocked(adminApi.getInstanceSettings).mockResolvedValueOnce({
      settings: {
        instanceName: "TravStats",
        maxUsers: 10,
        allowRegistration: false,
        betaFeaturesEnabled: false,
        frontendUrl: null,
        publicUrl: null,
        lanUrl: null,
        webauthnRpId: null,
        webauthnOrigins: [],
        countryThreshold: "transited",
      },
      passkeyStatus: null,
    } as unknown as Awaited<ReturnType<typeof adminApi.getInstanceSettings>>);
    renderAdmin("/settings/nutzer");
    await findNamed("region", "settingsRows:users.sections.accounts");
    // The menu entry carries the warn dot on every settings page, not only on its own.
    await waitFor(() => expect(document.querySelector("[data-warn-dot]")).not.toBeNull());
    cleanup();

    renderAdmin("/settings/allgemein");
    await findNamed("region", INSTANCE);
    await waitFor(() => expect(document.querySelector("[data-public-url-warning]")).not.toBeNull());
  });

  it("stays quiet when the address is set", async () => {
    renderAdmin("/settings/allgemein");
    await findNamed("region", INSTANCE);
    await waitFor(() => expect(document.querySelector("[data-warn-dot]")).toBeNull());
    expect(document.querySelector("[data-public-url-warning]")).toBeNull();
  });
});

describe("SettingsPage, the server's pages — the standard level (forgejo#321)", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    useSettingsLevelStore.setState({ level: "standard" });
  });
  // Unmount first: a level change under a mounted page re-renders it outside act.
  afterEach(() => {
    cleanup();
    useSettingsLevelStore.setState({ level: null });
  });

  it("keeps the expert pages out of the menu and says how many there are", async () => {
    renderAdmin("/settings/allgemein");
    await findNamed("region", INSTANCE);
    const menu = document.querySelector("[data-settings-menu] nav") as HTMLElement;
    const pages = within(menu)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(pages).toContain("/settings/nutzer");
    expect(pages).not.toContain("/settings/wartung");
    expect(pages).not.toContain("/settings/stamm");
    // The two other expert pages of the server area (settings v3 S5).
    expect(pages).not.toContain("/settings/adressen");
    expect(pages).not.toContain("/settings/eigene");
    // Server-Verbindungen waits for the switch on Funktionen, which is off here.
    expect(pages).not.toContain("/settings/srvconn");
    expect(document.querySelector('[data-expert-note="pages"]')).toHaveTextContent(
      "settings:level.morePages"
    );
  });

  it("shows the expert rows a search hit on a page's first section named (codex final review)", async () => {
    // The search links an expert row of the general section as
    // `/settings/allgemein?match=<row>&expert=1#general`; the request to show the
    // rows must survive the canonical redirect of an older address, too.
    renderAdmin("/admin/instance?section=instance&expert=1");
    const instance = await findNamed("region", INSTANCE);
    await waitFor(() => expect(instance).toHaveTextContent("settings:level.revealedRows"));
  });

  // The federation card of the service catalogue is the switch on Funktionen and the
  // page "Server-Verbindungen" (settings v3 S5); the old address lands on the switch.
  it("sends an old /admin link to the federation card to its switch on Funktionen", async () => {
    renderAdmin("/admin?section=federation");
    expect(await findNamed("region", "settingsRows:server.sections.sharing")).toBeInTheDocument();
    expect(document.querySelector("h1")).toHaveTextContent("settings:area.pages.funktionen");
    expect(document.querySelector('[data-service-card-id="federation"]')).toBeNull();
  });

  it("opens the server's own page of the catalogue, with the cards of the prototype", async () => {
    renderAdmin("/admin/externalServices?service=immich");
    await waitFor(() =>
      expect(document.querySelector('[data-service-card-id="immich"]')).toBeInTheDocument()
    );
    expect(document.querySelector("h1")).toHaveTextContent("settings:area.pages.dienste");
    // The geocoder, the mail card and the others with a page of their own are not on the grid.
    for (const id of [
      "smtp",
      "push",
      "usageStats",
      "federation",
      "geocoder",
      "selfHostedRouting",
    ]) {
      expect(document.querySelector(`[data-service-card-id="${id}"]`), id).toBeNull();
    }
  });

  it("opens an expert page a link names, with its sections and a note, not an empty page", async () => {
    renderAdmin("/admin/logging");
    expect(
      await findNamed("region", "settingsRows:maintenance.sections.logging")
    ).toBeInTheDocument();
    expect(document.querySelector("h1")).toHaveTextContent("settings:area.pages.wartung");
    expect(document.querySelector('[role="status"]')).toHaveTextContent(
      "settings:level.expertPage"
    );
  });
});

describe("SettingsPage, the server's pages — no heading repeats the one above it (forgejo#321)", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  // "Benutzer" under "Benutzer": a page with one section of its own name.
  it.each(AREA_PAGES.filter((p) => p.adminOnly).map((p) => [p.id]))(
    "holds on /settings/%s",
    async (page) => {
      const { unmount } = renderAdmin(`/settings/${page}`);
      await waitFor(() => expect(document.querySelector("h1")).not.toBeNull());
      expect(repeatedHeadings(document.body)).toEqual([]);
      unmount();
    }
  );
});

/**
 * Wave C finding C3 (independent review, 2026-09-17): jsdom has no
 * IntersectionObserver, so the page tests never mount a lazy section's body —
 * and none of them could have caught a broken reveal. The reveal is tested on
 * its own here with the controllable stub: nothing renders before the first
 * intersection, the body renders on it, and `onVisible` fires once however
 * often the observer reports. (The server pages of the settings area load
 * their own few requests at once; the master data editors, which fetch whole
 * catalogues, are the sections that still wait for the viewport.)
 */
describe("LazyBody, the lazy section reveal (Wave C finding C3)", () => {
  let io: FakeIntersectionObserverHandle;

  beforeEach(() => {
    io = installFakeIntersectionObserver();
  });
  afterEach(() => {
    cleanup();
    io.restore();
  });

  it("mounts the body on first intersection and notifies once, not again on a second", async () => {
    const onVisible = vi.fn();
    render(
      <LazyBody id="probe-body" onVisible={onVisible}>
        <span data-testid="probe">content</span>
      </LazyBody>
    );
    expect(document.getElementById("probe-body")?.childElementCount).toBe(0);
    await waitFor(() => expect(io.observerFor("probe-body")).toBeDefined());
    const observer = io.observerFor("probe-body");

    act(() => {
      observer?.trigger(true);
    });
    await waitFor(() => expect(document.getElementById("probe-body")?.childElementCount).toBe(1));
    expect(onVisible).toHaveBeenCalledTimes(1);

    act(() => {
      observer?.trigger(true);
    });
    expect(onVisible).toHaveBeenCalledTimes(1);
  });
});

/**
 * Wave C finding C1, follow-up round (2026-09-18): a browser measurement of
 * the first fix showed it did not actually work. `/admin?section=logging` at
 * 1440x900 landed the "logging" section at `top = 3196` with `scrollY =
 * 2786` — nowhere near the ~72px anchor offset. The sections that grow past
 * their 240px placeholder are the ones ABOVE the target, and their growth
 * pushes the target below the fold, where it never intersects.
 *
 * The fix reacts to the PAGE's layout changing (a `ResizeObserver` on the
 * sections column) rather than to one section's mount. Since forgejo#321 a
 * page holds fewer sections, but Instanz still stacks eight lazy ones above
 * "push". jsdom does no layout, so the fake `ResizeObserver` below only
 * proves the MECHANISM: a resize re-issues the scroll, repeated resizes keep
 * doing so within the time budget, a real scroll (wheel/touch/key) input
 * cancels it, and the time budget itself is a hard stop.
 */
describe("SettingsPage, the server's pages — deep-link scroll aligner (Wave C finding C1, follow-up)", () => {
  let resizeIO: FakeResizeObserverHandle;
  let scrollSpy: ReturnType<typeof vi.fn>;
  const DEEP_LINK = "/settings/funktionen?match=importmodus#features";

  beforeEach(() => {
    scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy as typeof Element.prototype.scrollIntoView;
    resizeIO = installFakeResizeObserver();
  });

  afterEach(() => {
    resizeIO.restore();
    vi.useRealTimers();
  });

  it("re-aligns the deep-linked section when ANY section's height changes, not only its own", async () => {
    renderAdmin(DEEP_LINK);
    await findNamed("region", "settingsRows:server.sections.features");

    // The first scroll runs against placeholder heights, same as before.
    await waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1));

    // Simulates a section ABOVE "push" growing past its placeholder —
    // the exact case the browser measurement caught.
    act(() => {
      resizeIO.observers[0]?.trigger();
    });
    expect(scrollSpy).toHaveBeenCalledTimes(2);
    expect(scrollSpy.mock.instances[1]).toBe(document.getElementById("settings-features"));

    // A second layout change within the budget realigns again.
    act(() => {
      resizeIO.observers[0]?.trigger();
    });
    expect(scrollSpy).toHaveBeenCalledTimes(3);
  });

  it("cancels re-aligning on real user scroll input", async () => {
    renderAdmin(DEEP_LINK);
    await findNamed("region", "settingsRows:server.sections.features");
    await waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1));

    act(() => {
      window.dispatchEvent(new Event("wheel"));
    });
    act(() => {
      resizeIO.observers[0]?.trigger();
    });

    // The wheel event cancelled the aligner before this resize — no new call.
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  it("does not cancel on an unrelated key (only scroll-intent keys do)", async () => {
    renderAdmin(DEEP_LINK);
    await findNamed("region", "settingsRows:server.sections.features");
    await waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    });
    act(() => {
      resizeIO.observers[0]?.trigger();
    });

    // Tab is not a scroll-intent key, so the aligner is still armed.
    expect(scrollSpy).toHaveBeenCalledTimes(2);
  });

  it("stops re-aligning once its time budget is spent", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    renderAdmin(DEEP_LINK);
    await findNamed("region", "settingsRows:server.sections.features");
    await waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1));

    act(() => {
      vi.advanceTimersByTime(DEEP_LINK_ALIGN_BUDGET_MS + 100);
    });
    act(() => {
      resizeIO.observers[0]?.trigger();
    });

    // The budget timer already cancelled the aligner — no new call.
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });
});

describe("SettingsPage, the server's pages — master data of a switched-off domain (forgejo#321 prototype)", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  // The suite's settings store enables no domain, so cruise is off here.
  it("says the domain is off and points to Reisearten, instead of leaving the page", async () => {
    renderAdmin("/admin/shipsMasterData");
    await findNamed("region", "admin:pages.shipsMasterData");
    const ships = document.getElementById("settings-shipsMasterData") as HTMLElement;
    const notice = ships.querySelector("[data-domain-off]") as HTMLElement;
    expect(notice).toHaveAttribute("data-domain-off", "cruise");
    expect(document.querySelector("h1")).toHaveTextContent("settings:area.pages.stamm");
    expect(within(notice).getByRole("link", { name: "settings:domainOff.action" })).toHaveAttribute(
      "href",
      "/settings/reisearten#domains"
    );
    // The catalogue itself is not drawn while its domain is off.
    expect(document.querySelector("#settings-shipsMasterData-body")).toBeNull();
  });
});
