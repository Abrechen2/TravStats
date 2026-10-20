import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// The version line under the settings menu asks the server (forgejo#321).
vi.mock("@/lib/api/version", () => ({
  versionApi: { get: vi.fn().mockResolvedValue({ version: "2.7.0", buildVersion: "2.7.0" }) },
}));

import { render, within, waitFor, act, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminPage from "../AdminPage";
import { DEEP_LINK_ALIGN_BUDGET_MS } from "../Admin/useDeepLinkScroll";
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
import { ADMIN_PAGES } from "../Admin/adminSections";

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
// The parsers section's template repository card (forgejo#309) reads its own
// setting on mount.
vi.mock("@/lib/api/templateRepo", () => ({
  templateRepoApi: {
    get: vi.fn().mockResolvedValue({
      url: null,
      effectiveUrl: "https://raw.githubusercontent.com/Abrechen2/travstats-templates/main",
      origin: "default",
      defaultUrl: "https://raw.githubusercontent.com/Abrechen2/travstats-templates/main",
    }),
    save: vi.fn(),
    test: vi.fn(),
  },
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
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

const renderAdmin = (entry = "/admin/instance") =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/:page" element={<AdminPage />} />
      </Routes>
    </MemoryRouter>
  );

/** The instance page's first section; awaiting it means the page has rendered. */
const INSTANCE = "admin:instance.title";

describe("AdminPage — one page per menu entry, its sections as anchors", () => {
  beforeEach(() => {
    // jsdom has no scrollIntoView at all; SettingsPage guards for its
    // absence at runtime, but pinning the deep-link behaviour needs a spy.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("renders every section of the page at once, not only one picked section", async () => {
    renderAdmin();

    // Four distinct sections of Instanz at once: a page that mounted one
    // picked section cannot pass this whichever one it picked.
    expect(await findNamed("region", INSTANCE)).toBeInTheDocument();
    expect(getNamed("region", "sharing:links.section.title")).toBeInTheDocument();
    expect(getNamed("region", "admin:importMode.title")).toBeInTheDocument();
    expect(getNamed("region", "settings:about.title")).toBeInTheDocument();
  });

  // Acceptance 2026-09-26: the page nested its own <main> inside AppShell's —
  // two main landmarks, which a screen reader announces as two pages.
  it("has exactly one main landmark", async () => {
    const { container } = renderAdmin();
    await findNamed("region", INSTANCE);
    expect(container.querySelectorAll("main")).toHaveLength(1);
  });

  it("gives every section landmark its admin-<id> anchor id, lazy sections included", async () => {
    renderAdmin();
    await findNamed("region", INSTANCE);

    for (const id of [
      "instance",
      "shareLinks",
      "importMode",
      "usageStats",
      "about",
      "geocoder",
      "federation",
      "push",
    ]) {
      expect(document.getElementById(`admin-${id}`)).not.toBeNull();
    }
  });

  it("draws the page's sections as anchor chips, and the menu as links to pages", async () => {
    renderAdmin();
    await findNamed("region", INSTANCE);

    const chips = getNamed("navigation", "settings:sectionChips");
    const anchors = within(chips).getAllByRole("link");
    expect(anchors.map((a) => a.getAttribute("href"))).toContain("#admin-push");
    expect(anchors.map((a) => a.getAttribute("href"))).toContain("#admin-instance");
    // The old column picked a section with a button; none should remain here.
    expect(within(chips).queryAllByRole("button")).toHaveLength(0);

    const menu = document.querySelector("[data-settings-menu] nav") as HTMLElement;
    const pages = within(menu)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(pages).toContain("/admin/users");
    expect(pages).toContain("/admin/logging");
    expect(within(menu).queryAllByRole("button")).toHaveLength(0);
  });

  it("scrolls a ?section= deep link into view once the page has rendered", async () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;

    renderAdmin("/admin/instance?section=push");
    await findNamed("region", INSTANCE);

    await waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1));
    expect(scrollSpy.mock.instances[0]).toBe(document.getElementById("admin-push"));
  });

  it("does not scroll anywhere without a ?section= param", async () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;

    renderAdmin("/admin/instance");
    await findNamed("region", INSTANCE);

    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("lands a pre-page ?section= link on the page of that name", async () => {
    renderAdmin("/admin?tab=general&section=users");
    expect(await findNamed("region", "admin:pages.users")).toBeInTheDocument();
    expect(document.querySelector("h1")).toHaveTextContent("admin:pages.users");
  });
});

describe("AdminPage — the standard level (forgejo#321)", () => {
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
    renderAdmin("/admin/instance");
    await findNamed("region", INSTANCE);
    const menu = document.querySelector("[data-settings-menu] nav") as HTMLElement;
    const pages = within(menu)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(pages).toContain("/admin/externalServices");
    expect(pages).not.toContain("/admin/logging");
    expect(pages).not.toContain("/admin/system");
    expect(document.querySelector('[data-expert-note="pages"]')).toHaveTextContent(
      "settings:level.morePages"
    );
  });

  it("opens an expert page a link names, with its sections and a note, not an empty page", async () => {
    renderAdmin("/admin/logging");
    expect(await findNamed("region", "admin:pages.logging")).toBeInTheDocument();
    expect(document.querySelector("h1")).toHaveTextContent("admin:pages.logging");
    expect(document.querySelector('[role="status"]')).toHaveTextContent(
      "settings:level.expertPage"
    );
  });
});

describe("AdminPage — no heading repeats the one above it (forgejo#321)", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  // "Benutzer" under "Benutzer": a page with one section of its own name.
  it.each(ADMIN_PAGES.filter((p) => !p.domain).map((p) => [p.id]))(
    "holds on /admin/%s",
    async (page) => {
      const { unmount } = renderAdmin(`/admin/${page}`);
      await waitFor(() => expect(document.querySelector("h1")).not.toBeNull());
      expect(repeatedHeadings(document.body)).toEqual([]);
      unmount();
    }
  );
});

/**
 * Wave C finding C3 (independent review, 2026-09-17): jsdom has no
 * IntersectionObserver at all, so every describe block above this one
 * relies on a lazy section's body deliberately never mounting — which also
 * means none of them could ever have caught a broken reveal. This block
 * installs the controllable stub from `intersectionObserverStub.ts` to drive
 * an actual intersection and observe what happens on the other side of it,
 * for exactly the "logging" section (`LAZY_ADMIN_SECTIONS`): its body renders
 * nothing until `loggingConfig` arrives from `adminApi.getLoggingConfig()`,
 * which `AdminPage`'s `sectionOnVisible.logging` fires from `LazyBody`'s
 * `onVisible` — the same wiring finding C1 fixed the placeholder height and
 * deep-link re-scroll around.
 */
describe("AdminPage — lazy section reveal (Wave C finding C3)", () => {
  let io: FakeIntersectionObserverHandle;

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    io = installFakeIntersectionObserver();
  });

  afterEach(() => {
    io.restore();
  });

  it("mounts the logging section's body and fetches its data on first intersection, but not again on a second", async () => {
    renderAdmin("/admin/logging");
    await findNamed("region", "admin:pages.logging");

    const bodyEl = document.getElementById("admin-logging-body");
    expect(bodyEl?.childElementCount).toBe(0);

    // LazyBody creates its IntersectionObserver from a passive effect, which
    // commits asynchronously relative to the DOM. Waiting for the observer
    // itself, rather than a proxy for it, is what closes that race.
    await waitFor(() => expect(io.observerFor("admin-logging-body")).toBeDefined());
    const observer = io.observerFor("admin-logging-body");

    act(() => {
      observer?.trigger(true);
    });
    await waitFor(() => expect(bodyEl?.childElementCount).toBeGreaterThan(0));

    const { adminApi } = await import("@/lib/api");
    expect(adminApi.getLoggingConfig).toHaveBeenCalledTimes(1);

    // A second intersection report for the same body (a real browser would
    // not deliver one post-disconnect, but the point here is the reveal's OWN
    // `notifiedRef` guard, not that detail — see the stub).
    act(() => {
      observer?.trigger(true);
    });
    expect(adminApi.getLoggingConfig).toHaveBeenCalledTimes(1);
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
describe("AdminPage — deep-link scroll aligner (Wave C finding C1, follow-up)", () => {
  let resizeIO: FakeResizeObserverHandle;
  let scrollSpy: ReturnType<typeof vi.fn>;
  const DEEP_LINK = "/admin/instance?section=push";

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
    await findNamed("region", INSTANCE);

    // The first scroll runs against placeholder heights, same as before.
    await waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1));

    // Simulates a section ABOVE "push" growing past its placeholder —
    // the exact case the browser measurement caught.
    act(() => {
      resizeIO.observers[0]?.trigger();
    });
    expect(scrollSpy).toHaveBeenCalledTimes(2);
    expect(scrollSpy.mock.instances[1]).toBe(document.getElementById("admin-push"));

    // A second layout change within the budget realigns again.
    act(() => {
      resizeIO.observers[0]?.trigger();
    });
    expect(scrollSpy).toHaveBeenCalledTimes(3);
  });

  it("cancels re-aligning on real user scroll input", async () => {
    renderAdmin(DEEP_LINK);
    await findNamed("region", INSTANCE);
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
    await findNamed("region", INSTANCE);
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
    await findNamed("region", INSTANCE);
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
