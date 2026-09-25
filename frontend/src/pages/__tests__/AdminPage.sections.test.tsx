import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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

/**
 * Round 4 ("one page, anchor jumps" — tester feedback, forgejo#…): the admin
 * page used to hold every section's data but mount only the ONE picked by
 * `activeSection` state, swapping the whole `<main>` out on every click —
 * unlike the settings page, whose index is a set of `<a href="#settings-…">`
 * jumps into one long page. This file pins the same shape for admin: every
 * section of the active tab renders at once, and the index draws anchors
 * instead of buttons that used to pick which single section was mounted.
 *
 * Deliberate-break protocol: put back the pre-round-4
 * `{activeSection === "system" && <SystemInfoTab .../>}` style conditional
 * around each section in AdminPage.tsx and the first test below fails
 * (only "admin:tabs.system" is in the document).
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

const renderAdmin = (entry = "/admin") =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <AdminPage />
    </MemoryRouter>
  );

describe("AdminPage — one page, anchor jumps", () => {
  beforeEach(() => {
    // jsdom has no scrollIntoView at all; SettingsPage guards for its
    // absence at runtime, but pinning the deep-link behaviour needs a spy.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("renders several sections of the active tab at once, not only one picked section", async () => {
    renderAdmin();

    // Today only the active section rendered; asserting on FOUR distinct
    // sections at once (not just two) is what the pre-round-4 page cannot
    // pass no matter which single section happened to be active.
    expect(await screen.findByRole("region", { name: "admin:tabs.system" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "admin:tabs.users" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "admin:tabs.invitations" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "admin:tabs.parsers" })).toBeInTheDocument();
  });

  it("gives every section landmark its admin-<id> anchor id, lazy sections included", async () => {
    renderAdmin();
    await screen.findByRole("region", { name: "admin:tabs.system" });

    for (const id of [
      "system",
      "instance",
      "users",
      "invitations",
      "externalServices",
      "parsers",
      "logging",
      "backups",
      "smtp",
    ]) {
      expect(document.getElementById(`admin-${id}`)).not.toBeNull();
    }
  });

  it("draws the section index as anchors into the page, not buttons that swap sections", async () => {
    renderAdmin();
    await screen.findByRole("region", { name: "admin:tabs.system" });

    const sectionNav = screen.getByRole("navigation", { name: "admin:sectionPicker" });
    const links = within(sectionNav).getAllByRole("link");
    expect(links.length).toBeGreaterThanOrEqual(9); // the general tab's own sections
    expect(links.some((link) => link.getAttribute("href") === "#admin-system")).toBe(true);
    expect(links.some((link) => link.getAttribute("href") === "#admin-logging")).toBe(true);

    // The old column picked a section with a button; none should remain here.
    expect(within(sectionNav).queryAllByRole("button")).toHaveLength(0);
  });

  it("scrolls a ?section= deep link into view once the page has rendered", async () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;

    renderAdmin("/admin?section=logging");
    await screen.findByRole("region", { name: "admin:tabs.system" });

    await waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1));
    expect(scrollSpy.mock.instances[0]).toBe(document.getElementById("admin-logging"));
  });

  it("does not scroll anywhere without a ?section= param", async () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;

    renderAdmin("/admin");
    await screen.findByRole("region", { name: "admin:tabs.system" });

    expect(scrollSpy).not.toHaveBeenCalled();
  });
});

/**
 * Wave C finding C3 (independent review, 2026-09-17): jsdom has no
 * IntersectionObserver at all, so every describe block above this one
 * relies on a lazy section's body deliberately never mounting — which also
 * means none of them could ever have caught a broken reveal. This block
 * installs the controllable stub from `intersectionObserverStub.ts` to drive
 * an actual intersection and observe what happens on the other side of it,
 * for exactly the "logging" section (general tab, `LAZY_ADMIN_SECTIONS`):
 * its body renders nothing until `loggingConfig` arrives from
 * `adminApi.getLoggingConfig()`, which `AdminPage`'s `sectionOnVisible.logging`
 * fires from `LazySection`'s `onVisible` — the same wiring finding C1 fixed
 * the placeholder height and deep-link re-scroll around.
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
    renderAdmin();
    await screen.findByRole("region", { name: "admin:tabs.system" });

    const sectionEl = document.getElementById("admin-logging");
    expect(sectionEl?.childElementCount).toBe(0);

    // LazySection creates its IntersectionObserver from a passive effect,
    // which commits asynchronously relative to the DOM — a sibling
    // region (like "system", awaited above) can already be in the
    // document before THIS section's effect has run. Normally that gap
    // is sub-millisecond and invisible; under CPU contention (reproduced
    // locally by saturating every core) it widened enough to read
    // `observerFor` as undefined. Waiting for the observer itself,
    // rather than a proxy for it, is what actually closes the race.
    await waitFor(() => expect(io.observerFor("admin-logging")).toBeDefined());
    const observer = io.observerFor("admin-logging");

    act(() => {
      observer?.trigger(true);
    });
    await waitFor(() => expect(sectionEl?.childElementCount).toBeGreaterThan(0));

    const { adminApi } = await import("@/lib/api");
    expect(adminApi.getLoggingConfig).toHaveBeenCalledTimes(1);

    // A second intersection report for the same section (a real browser
    // would not deliver one post-disconnect, but the point here is
    // LazySection's OWN `notifiedRef` guard, not that detail — see the stub).
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
 * 2786` — nowhere near the ~72px anchor offset. The first fix keyed the
 * corrective re-scroll on the DEEP-LINK TARGET's own `LazySection` mounting,
 * but the sections that actually grow past their 240px placeholder are the
 * ones ABOVE the target (they mount as the page scrolls past them and are
 * far taller once real content lands) — that growth pushes the target
 * further down, below the fold, where it never intersects and therefore
 * never mounts, so the "wait for target mount" correction never fired at
 * all.
 *
 * The fix now reacts to the PAGE's layout changing (a `ResizeObserver` on
 * the sections column) rather than to one section's mount. jsdom does no
 * layout, so `getBoundingClientRect()` cannot be used to pin actual pixel
 * convergence here — the fake `ResizeObserver` below only proves the
 * MECHANISM: a resize re-issues the scroll, repeated resizes keep doing so
 * within the time budget, a real scroll (wheel/touch/key) input cancels it,
 * and the time budget itself is a hard stop. See the report for what only a
 * browser can confirm.
 */
describe("AdminPage — deep-link scroll aligner (Wave C finding C1, follow-up)", () => {
  let resizeIO: FakeResizeObserverHandle;
  let scrollSpy: ReturnType<typeof vi.fn>;

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
    renderAdmin("/admin?section=logging");
    await screen.findByRole("region", { name: "admin:tabs.system" });

    // The first scroll runs against placeholder heights, same as before.
    await waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1));

    // Simulates a section ABOVE "logging" growing past its placeholder —
    // the exact case the browser measurement caught.
    act(() => {
      resizeIO.observers[0]?.trigger();
    });
    expect(scrollSpy).toHaveBeenCalledTimes(2);
    expect(scrollSpy.mock.instances[1]).toBe(document.getElementById("admin-logging"));

    // A second layout change within the budget realigns again.
    act(() => {
      resizeIO.observers[0]?.trigger();
    });
    expect(scrollSpy).toHaveBeenCalledTimes(3);
  });

  it("cancels re-aligning on real user scroll input", async () => {
    renderAdmin("/admin?section=logging");
    await screen.findByRole("region", { name: "admin:tabs.system" });
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
    renderAdmin("/admin?section=logging");
    await screen.findByRole("region", { name: "admin:tabs.system" });
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

    renderAdmin("/admin?section=logging");
    await screen.findByRole("region", { name: "admin:tabs.system" });
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
