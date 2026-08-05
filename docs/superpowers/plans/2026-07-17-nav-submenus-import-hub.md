# Nav Submenus (Variante B) + Central Import Hub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group the top navigation into Logbuch/Support/System submenus (owner's Variante B) and turn the settings import section into a domain-grouped central hub, deleting the dead round-trip tile.

**Architecture:** Frontend-only. A pure model hook (`useNavItems`) builds the grouped nav tree (domain gating, admin gating, single-child collapse, badge aggregation); one reusable `NavDropdown` renders every submenu; `NavigationBar.tsx` shrinks to composition. `ImportSection` iterates `AVAILABLE_DOMAINS` and renders per-domain tile groups.

**Tech Stack:** React 18 + TypeScript strict, react-router-dom (`Link`, `useLocation`), Zustand stores, Vitest + Testing Library, react-i18next via the project wrapper.

**Spec:** `docs/superpowers/specs/2026-07-17-nav-submenus-import-hub-design.md`
**Branch:** `feat/nav-submenus-import-hub` (exists, spec committed)

## Global Constraints

- `any` is FORBIDDEN — `unknown` + type guards (CLAUDE.md).
- `useTranslation` from `"../hooks/useTranslation"` (project wrapper), NEVER from react-i18next.
- User-facing strings: German primary + English mirror, ALWAYS both in the same commit.
- Domain gating: iterate `AVAILABLE_DOMAINS` from `frontend/src/shared/domains.ts`; never hardcode `enabledDomains.includes('flight')`.
- No `console.log` — `import { logger } from "../lib/logger"` if needed.
- Immutability: spread, no in-place mutation. Files ≤800 lines hard max. printWidth 100, double quotes.
- All test commands run from `D:\TravStats_Projekt\TravStats\frontend`.
- Commit messages: conventional commits, English.

## File Structure

```
frontend/src/components/Nav/useNavItems.ts          (NEW — pure nav model hook)
frontend/src/components/Nav/NavDropdown.tsx          (NEW — reusable dropdown)
frontend/src/components/Nav/__tests__/useNavItems.test.ts   (NEW)
frontend/src/components/Nav/__tests__/NavDropdown.test.tsx  (NEW)
frontend/src/components/NavigationBar.tsx            (MODIFY — compose model + dropdowns)
frontend/src/__tests__/components/NavigationBar.test.tsx (MODIFY — adapt to groups)
frontend/src/components/Settings/ImportSection.tsx   (MODIFY — domain groups)
frontend/src/components/Settings/__tests__/ImportSection.test.tsx (NEW)
frontend/src/components/import/RoundTripImportTile.tsx      (DELETE)
frontend/src/components/import/RoundTripImportTile.test.tsx (DELETE)
e2e/import.roundtrip.spec.ts                         (DELETE — drives the deleted tile)
frontend/src/pages/FlightsTablePage.tsx              (MODIFY — import hub link)
frontend/src/i18n/resources/de/dashboard.json        (MODIFY — nav.* keys)
frontend/src/i18n/resources/en/dashboard.json        (MODIFY — nav.* keys)
frontend/src/i18n/resources/de/settings.json         (MODIFY — drop roundTrip, description, add openHub)
frontend/src/i18n/resources/en/settings.json         (MODIFY — same)
```

---

### Task 1: `useNavItems` — the pure nav model hook

**Files:**
- Create: `frontend/src/components/Nav/useNavItems.ts`
- Test: `frontend/src/components/Nav/__tests__/useNavItems.test.ts`

**Interfaces:**
- Consumes: `useEnabledDomains()` (`{enabled: DomainKey[], isEnabled}`), `useAuthStore` (`user.isAdmin`), `DOMAINS`/`AVAILABLE_DOMAINS` from `../../shared/domains`, `useTranslation` wrapper.
- Produces (later tasks rely on these exact names):
  ```ts
  export interface NavLeaf {
    kind: "leaf";
    id: string;
    path: string;
    label: string;
    badge?: number;
    warn?: boolean;
    betaBadge?: boolean;
  }
  export interface NavGroup {
    kind: "group";
    id: string;
    label: string;
    badge?: number;
    children: NavLeaf[];
  }
  export type NavNode = NavLeaf | NavGroup;
  export function isPathActive(path: string, pathname: string): boolean;
  export function isNodeActive(node: NavNode, pathname: string): boolean;
  export function useNavItems(pendingUpdatesCount: number, pathname: string): {
    center: NavNode[];
    system: NavNode;
  };
  ```

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/Nav/__tests__/useNavItems.test.ts`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

// Predictable i18n: return the key so labels are assertable without locale files.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const authState: { user: { isAdmin: boolean } | null } = { user: { isAdmin: false } };
vi.mock("../../../store/authStore", () => ({
  useAuthStore: (sel?: (s: typeof authState) => unknown) => (sel ? sel(authState) : authState),
}));

vi.unmock("../../../store/settingsStore");

import { useNavItems, isNodeActive, type NavGroup, type NavLeaf } from "../useNavItems";
import { useSettingsStore } from "../../../store/settingsStore";

function run(pending = 0, pathname = "/") {
  return renderHook(() => useNavItems(pending, pathname)).result.current;
}

describe("useNavItems — Logbuch grouping", () => {
  beforeEach(() => {
    authState.user = { isAdmin: false };
    useSettingsStore.setState({ enabledDomains: ["flight", "cruise"] });
  });

  it("groups two enabled domains under a Logbuch node", () => {
    const { center } = run();
    const logbuch = center.find((n) => n.id === "logbook") as NavGroup;
    expect(logbuch.kind).toBe("group");
    expect(logbuch.children.map((c) => c.path)).toEqual(["/flights", "/cruises"]);
  });

  it("collapses Logbuch to a direct link with exactly one enabled domain", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"] });
    const { center } = run();
    const logbuch = center.find((n) => n.id === "logbook") as NavLeaf;
    expect(logbuch.kind).toBe("leaf");
    expect(logbuch.path).toBe("/flights");
    expect(logbuch.label).toBe("common:domain.flight");
  });

  it("omits the Logbuch node entirely with zero enabled domains", () => {
    useSettingsStore.setState({ enabledDomains: [] });
    const { center } = run();
    expect(center.some((n) => n.id === "logbook")).toBe(false);
  });

  it("keeps Reisen a top-level sibling", () => {
    const { center } = run();
    expect(center.some((n) => n.kind === "leaf" && n.path === "/trips")).toBe(true);
  });
});

describe("useNavItems — System group", () => {
  beforeEach(() => {
    authState.user = { isAdmin: false };
    useSettingsStore.setState({ enabledDomains: ["flight"] });
  });

  it("collapses to a direct Einstellungen link for a non-admin with zero pending updates", () => {
    const { system } = run(0, "/");
    expect(system.kind).toBe("leaf");
    expect((system as NavLeaf).path).toBe("/settings");
  });

  it("shows the Updates entry with badge when pending updates exist", () => {
    const { system } = run(3, "/");
    expect(system.kind).toBe("group");
    const updates = (system as NavGroup).children.find((c) => c.path === "/pending-updates");
    expect(updates?.badge).toBe(3);
    expect(updates?.warn).toBe(true);
    expect((system as NavGroup).badge).toBe(3);
  });

  it("shows the Updates entry with zero count while ON the pending-updates route", () => {
    const { system } = run(0, "/pending-updates");
    expect(system.kind).toBe("group");
    expect(
      (system as NavGroup).children.some((c) => c.path === "/pending-updates")
    ).toBe(true);
  });

  it("adds Admin and Parser (beta) for admins only", () => {
    authState.user = { isAdmin: true };
    const { system } = run(0, "/");
    const g = system as NavGroup;
    expect(g.kind).toBe("group");
    expect(g.children.map((c) => c.path)).toEqual(["/settings", "/admin", "/parser"]);
    expect(g.children.find((c) => c.path === "/parser")?.betaBadge).toBe(true);
  });
});

describe("isNodeActive", () => {
  it("marks a group active when any child route matches", () => {
    useSettingsStore.setState({ enabledDomains: ["flight", "cruise"] });
    const { center } = run(0, "/cruises/42");
    const logbuch = center.find((n) => n.id === "logbook")!;
    expect(isNodeActive(logbuch, "/cruises/42")).toBe(true);
    expect(isNodeActive(logbuch, "/trips")).toBe(false);
  });

  it("dashboard leaf is active only on exact root", () => {
    const { center } = run(0, "/");
    const dash = center.find((n) => n.id === "dashboard")!;
    expect(isNodeActive(dash, "/")).toBe(true);
    expect(isNodeActive(dash, "/flights")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest --run src/components/Nav/__tests__/useNavItems.test.ts`
Expected: FAIL — `Cannot find module '../useNavItems'`.

- [ ] **Step 3: Implement the hook**

`frontend/src/components/Nav/useNavItems.ts`:

```tsx
import { useMemo } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useAuthStore } from "../../store/authStore";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { AVAILABLE_DOMAINS, DOMAINS } from "../../shared/domains";

export interface NavLeaf {
  kind: "leaf";
  id: string;
  path: string;
  label: string;
  badge?: number;
  warn?: boolean;
  betaBadge?: boolean;
}

export interface NavGroup {
  kind: "group";
  id: string;
  label: string;
  badge?: number;
  children: NavLeaf[];
}

export type NavNode = NavLeaf | NavGroup;

export function isPathActive(path: string, pathname: string): boolean {
  if (path === "/") return pathname === "/";
  return pathname.startsWith(path);
}

export function isNodeActive(node: NavNode, pathname: string): boolean {
  if (node.kind === "leaf") return isPathActive(node.path, pathname);
  return node.children.some((c) => isPathActive(c.path, pathname));
}

/** A group with exactly one visible child renders as that child (owner rule:
 *  no one-item dropdowns). */
function collapseSingleChild(group: NavGroup): NavNode {
  if (group.children.length === 1) return { ...group.children[0], id: group.id };
  return group;
}

/**
 * Pure nav model for NavigationBar (desktop + mobile render the same tree).
 * `pathname` is passed in (not read via useLocation) so the model stays
 * testable without a router and so the caller controls re-render timing.
 */
export function useNavItems(
  pendingUpdatesCount: number,
  pathname: string
): { center: NavNode[]; system: NavNode } {
  const { t } = useTranslation(["dashboard", "common", "trips"]);
  const user = useAuthStore((s) => s.user);
  const { isEnabled } = useEnabledDomains();
  const isAdmin = user?.isAdmin ?? false;

  return useMemo(() => {
    const domainChildren: NavLeaf[] = AVAILABLE_DOMAINS.filter(isEnabled).map((key) => ({
      kind: "leaf",
      id: `domain-${key}`,
      path: DOMAINS[key].routePrefix,
      label: t(`common:${DOMAINS[key].i18nKey}`),
    }));

    const center: NavNode[] = [
      { kind: "leaf", id: "dashboard", path: "/", label: t("dashboard:title") },
      ...(domainChildren.length > 0
        ? [
            collapseSingleChild({
              kind: "group",
              id: "logbook",
              label: t("dashboard:nav.logbook"),
              children: domainChildren,
            }),
          ]
        : []),
      { kind: "leaf", id: "trips", path: "/trips", label: t("trips:tab") },
      { kind: "leaf", id: "stats", path: "/stats", label: t("dashboard:stats") },
      {
        kind: "leaf",
        id: "achievements",
        path: "/achievements",
        label: t("dashboard:achievements"),
      },
    ];

    const showPendingUpdates = pendingUpdatesCount > 0 || pathname === "/pending-updates";
    const systemChildren: NavLeaf[] = [
      { kind: "leaf", id: "settings", path: "/settings", label: t("dashboard:settings") },
      ...(showPendingUpdates
        ? [
            {
              kind: "leaf" as const,
              id: "pending-updates",
              path: "/pending-updates",
              label: t("dashboard:pendingUpdates"),
              badge: pendingUpdatesCount,
              warn: true,
            },
          ]
        : []),
      ...(isAdmin
        ? [
            { kind: "leaf" as const, id: "admin", path: "/admin", label: t("dashboard:admin") },
            {
              kind: "leaf" as const,
              id: "parser",
              path: "/parser",
              label: t("dashboard:parser"),
              betaBadge: true,
            },
          ]
        : []),
    ];

    const system = collapseSingleChild({
      kind: "group",
      id: "system",
      label: t("dashboard:nav.system"),
      badge: pendingUpdatesCount > 0 ? pendingUpdatesCount : undefined,
      children: systemChildren,
    });

    return { center, system };
  }, [t, isEnabled, isAdmin, pendingUpdatesCount, pathname]);
}
```

Note the child order in the system group: Einstellungen, Updates, Admin, Parser — but the
admin test asserts `["/settings", "/admin", "/parser"]` because Updates is hidden at count 0.
With count > 0 the order is `["/settings", "/pending-updates", ...]`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest --run src/components/Nav/__tests__/useNavItems.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Typecheck + lint + commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

```bash
git add frontend/src/components/Nav/useNavItems.ts frontend/src/components/Nav/__tests__/useNavItems.test.ts
git commit -m "feat(nav): pure nav model hook with grouping, gating and collapse rules"
```

---

### Task 2: `NavDropdown` — one reusable submenu

**Files:**
- Create: `frontend/src/components/Nav/NavDropdown.tsx`
- Test: `frontend/src/components/Nav/__tests__/NavDropdown.test.tsx`

**Interfaces:**
- Consumes: `NavGroup`, `NavLeaf`, `isPathActive`, `isNodeActive` from `./useNavItems` (Task 1); `useClickOutside` from `../../hooks/useClickOutside`; `Link`, `useLocation` from react-router-dom.
- Produces:
  ```tsx
  export interface ExternalLink { id: string; label: string; href: string; icon?: JSX.Element }
  interface NavDropdownProps {
    group: NavGroup;            // router-link children
    externalLinks?: never;
    align?: "left" | "right";
    variant?: "nav" | "chip";   // "nav" = center bar item look, "chip" = right-side bordered chip
  }
  interface ExternalDropdownProps {
    group?: never;
    label: string;
    externalLinks: ExternalLink[];
    align?: "left" | "right";
    variant?: "nav" | "chip";
  }
  export default function NavDropdown(props: NavDropdownProps | ExternalDropdownProps): JSX.Element;
  ```
  Internal-link children navigate with `<Link>` and close the menu; external links render
  `<a target="_blank" rel="noopener noreferrer">`. Trigger has `aria-haspopup="menu"` and
  `aria-expanded`; Escape and outside click close; badge (9+ cap) and beta pill render like
  today's flat items.

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/Nav/__tests__/NavDropdown.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import NavDropdown from "../NavDropdown";
import type { NavGroup } from "../useNavItems";

const group: NavGroup = {
  kind: "group",
  id: "logbook",
  label: "Logbuch",
  children: [
    { kind: "leaf", id: "domain-flight", path: "/flights", label: "Flüge" },
    { kind: "leaf", id: "domain-cruise", path: "/cruises", label: "Kreuzfahrten" },
  ],
};

function renderDd() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <NavDropdown group={group} />
    </MemoryRouter>
  );
}

describe("NavDropdown", () => {
  it("is closed initially and opens on trigger click", () => {
    renderDd();
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Logbuch/ }));
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Logbuch/ }).getAttribute("aria-expanded")).toBe(
      "true"
    );
  });

  it("renders children as router links", () => {
    renderDd();
    fireEvent.click(screen.getByRole("button", { name: /Logbuch/ }));
    const flights = screen.getByRole("menuitem", { name: "Flüge" });
    expect(flights.getAttribute("href")).toBe("/flights");
  });

  it("closes on Escape", () => {
    renderDd();
    fireEvent.click(screen.getByRole("button", { name: /Logbuch/ }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes when a child link is clicked", () => {
    renderDd();
    fireEvent.click(screen.getByRole("button", { name: /Logbuch/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Flüge" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("renders external links with target=_blank", () => {
    render(
      <MemoryRouter>
        <NavDropdown
          label="Support"
          externalLinks={[{ id: "donate", label: "Donate", href: "https://example.org" }]}
        />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /Support/ }));
    const a = screen.getByRole("menuitem", { name: "Donate" });
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("caps the trigger badge at 9+", () => {
    render(
      <MemoryRouter>
        <NavDropdown group={{ ...group, badge: 12 }} />
      </MemoryRouter>
    );
    expect(screen.getByText("9+")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest --run src/components/Nav/__tests__/NavDropdown.test.tsx`
Expected: FAIL — `Cannot find module '../NavDropdown'`.

- [ ] **Step 3: Implement**

`frontend/src/components/Nav/NavDropdown.tsx`:

```tsx
import { useRef, useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "react-router-dom";
import { useClickOutside } from "../../hooks/useClickOutside";
import { isNodeActive, isPathActive, type NavGroup } from "./useNavItems";

export interface ExternalLink {
  id: string;
  label: string;
  href: string;
  icon?: JSX.Element;
}

interface NavDropdownProps {
  group: NavGroup;
  externalLinks?: never;
  label?: never;
  align?: "left" | "right";
  variant?: "nav" | "chip";
}

interface ExternalDropdownProps {
  group?: never;
  label: string;
  externalLinks: ExternalLink[];
  align?: "left" | "right";
  variant?: "nav" | "chip";
}

function badgeText(badge: number): string {
  return badge > 9 ? "9+" : String(badge);
}

/**
 * One dropdown for every nav submenu (Logbuch, Support, System). Click
 * toggles, Escape / outside click / navigating a child closes. Hover-only
 * menus are deliberately avoided (touch + a11y).
 */
export default function NavDropdown(props: NavDropdownProps | ExternalDropdownProps): JSX.Element {
  const { align = "left", variant = "nav" } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(rootRef, close);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const label = props.group ? props.group.label : props.label;
  const badge = props.group?.badge;
  const active = props.group ? isNodeActive(props.group, location.pathname) : false;

  const triggerClass =
    variant === "chip"
      ? "flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors duration-150"
      : "relative px-3 py-1.5 text-sm transition-colors duration-200 rounded-md flex items-center gap-1";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={triggerClass}
        style={
          variant === "chip"
            ? { color: "var(--text-muted)", border: "1px solid var(--color-border)" }
            : {
                fontWeight: active ? 600 : 500,
                color: active ? "var(--accent)" : "var(--text-muted)",
                background: active || open ? "var(--bg-elevated)" : "transparent",
              }
        }
      >
        {label}
        <span aria-hidden="true" className="text-[9px] opacity-70">
          ▼
        </span>
        {typeof badge === "number" && badge > 0 && (
          <span
            className="absolute -top-1 -right-1 text-xs font-bold rounded-full h-4 min-w-4 px-0.5 flex items-center justify-center"
            style={{ background: "var(--danger)", color: "#fff" }}
          >
            {badgeText(badge)}
          </span>
        )}
        {variant === "nav" && active && (
          <span
            className="absolute -bottom-px left-2 right-2 h-[3px] rounded-full"
            style={{ background: "var(--accent)" }}
          />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute top-full mt-1.5 min-w-[176px] z-[70] rounded-lg p-1 shadow-xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-border)" }}
        >
          {props.group
            ? props.group.children.map((child) => {
                const childActive = isPathActive(child.path, location.pathname);
                return (
                  <Link
                    key={child.id}
                    role="menuitem"
                    to={child.path}
                    onClick={close}
                    aria-current={childActive ? "page" : undefined}
                    className="flex items-center justify-between gap-2.5 px-2.5 py-1.5 rounded-md text-sm"
                    style={{
                      color: childActive
                        ? "var(--accent)"
                        : child.warn
                          ? "var(--warning)"
                          : "var(--text-muted)",
                      fontWeight: childActive ? 600 : 500,
                    }}
                  >
                    <span className="flex items-center gap-1.5">
                      {child.label}
                      {child.betaBadge && (
                        <span className="inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium leading-none text-amber-700 bg-amber-100 ring-1 ring-inset ring-amber-600/20 dark:text-amber-400 dark:bg-amber-500/10 dark:ring-amber-400/20">
                          Beta
                        </span>
                      )}
                    </span>
                    {(child.badge ?? 0) > 0 && (
                      <span
                        className="text-xs font-bold rounded-full h-4 min-w-4 px-0.5 flex items-center justify-center"
                        style={{ background: "var(--danger)", color: "#fff" }}
                      >
                        {badgeText(child.badge ?? 0)}
                      </span>
                    )}
                  </Link>
                );
              })
            : props.externalLinks.map((linkItem) => (
                <a
                  key={linkItem.id}
                  role="menuitem"
                  href={linkItem.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={close}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm"
                  style={{ color: "var(--text-muted)" }}
                >
                  {linkItem.icon}
                  {linkItem.label}
                </a>
              ))}
        </div>
      )}
    </div>
  );
}
```

Menu-item hover styling: add these rules once to `frontend/src/index.css` (or the existing
global stylesheet where `.nav-icon-btn` lives) so hover works without inline JS handlers:

```css
[role="menu"] [role="menuitem"]:hover {
  background: var(--bg-surface);
  color: var(--text-primary);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest --run src/components/Nav/__tests__/NavDropdown.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck + lint + commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

```bash
git add frontend/src/components/Nav/NavDropdown.tsx frontend/src/components/Nav/__tests__/NavDropdown.test.tsx frontend/src/index.css
git commit -m "feat(nav): reusable NavDropdown with click/escape/outside close + aria wiring"
```

---

### Task 3: NavigationBar desktop — compose model + dropdowns

**Files:**
- Modify: `frontend/src/components/NavigationBar.tsx`
- Modify: `frontend/src/__tests__/components/NavigationBar.test.tsx`
- Modify: `frontend/src/i18n/resources/de/dashboard.json` + `frontend/src/i18n/resources/en/dashboard.json`

**Interfaces:**
- Consumes: `useNavItems(pendingUpdatesCount, location.pathname)` → `{center, system}`; `NavDropdown` (both prop shapes); `isPathActive`/`isNodeActive`.
- Produces: no new exports — NavigationBar keeps its default export. The old inline `navItems` array and `isActive` are DELETED.

- [ ] **Step 1: Add i18n keys (DE + EN together)**

In `frontend/src/i18n/resources/de/dashboard.json`, add inside the top-level object:

```json
"nav": {
  "logbook": "Logbuch",
  "support": "Support",
  "system": "System"
}
```

In `frontend/src/i18n/resources/en/dashboard.json`:

```json
"nav": {
  "logbook": "Logbook",
  "support": "Support",
  "system": "System"
}
```

- [ ] **Step 2: Adapt the NavigationBar test to the grouped structure**

Rewrite `frontend/src/__tests__/components/NavigationBar.test.tsx` — keep the existing
mock block at the top (lib/api, authStore, DiagnosticExportModal, unmock settingsStore)
EXACTLY as it is, replace the test bodies:

```tsx
describe("NavigationBar grouped navigation", () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ["flight", "cruise"] });
  });

  function renderNav() {
    return render(
      <MemoryRouter>
        <NavigationBar />
      </MemoryRouter>
    );
  }

  it("renders a Logbuch dropdown with both domains when two are enabled", () => {
    renderNav();
    const trigger = screen.getAllByRole("button", { name: /Logbuch/ })[0];
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: /Flüge|Flights/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Kreuzfahrten|Cruises/ })).toBeTruthy();
  });

  it("collapses Logbuch to a direct link with one enabled domain", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"] });
    renderNav();
    expect(screen.queryByRole("button", { name: /Logbuch/ })).toBeNull();
    expect(screen.getAllByRole("link", { name: /Flüge|Flights/ }).length).toBeGreaterThan(0);
  });

  it("collapses System to a direct Einstellungen link for non-admin without updates", () => {
    renderNav();
    expect(screen.queryByRole("button", { name: /System/ })).toBeNull();
    expect(
      screen.getAllByRole("link", { name: /Einstellungen|Settings/ }).length
    ).toBeGreaterThan(0);
  });

  it("keeps the Bug button visible and groups support links in a dropdown", () => {
    renderNav();
    expect(screen.getByRole("button", { name: /Bug/ })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /Support/ })[0]);
    expect(screen.getByRole("menuitem", { name: /Donate/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Star/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Discord/ })).toBeTruthy();
  });
});
```

(Import `fireEvent` from `@testing-library/react` in the test file's import line.)

- [ ] **Step 3: Run the adapted test to verify it fails against the old flat nav**

Run: `npx vitest --run src/__tests__/components/NavigationBar.test.tsx`
Expected: FAIL — no "Logbuch" button exists yet.

- [ ] **Step 4: Rewire the desktop bar**

In `frontend/src/components/NavigationBar.tsx`:

1. Add imports:
   ```tsx
   import NavDropdown, { type ExternalLink } from "./Nav/NavDropdown";
   import { useNavItems, isPathActive } from "./Nav/useNavItems";
   ```
2. DELETE the `NavItem` interface, the `navItems` array (lines ~65-91) and the
   `isActive` function; keep `showPendingUpdates` logic OUT (it lives in the hook now).
   Keep the pendingUpdates polling effect exactly as-is.
3. After the existing hooks add:
   ```tsx
   const { center, system } = useNavItems(pendingUpdatesCount, location.pathname);

   const supportLinks: ExternalLink[] = [
     {
       id: "donate",
       label: "Donate",
       href: "https://www.paypal.com/donate?hosted_button_id=HW9MPYVURCT42",
       icon: (
         <svg width="11" height="11" viewBox="0 0 16 16" fill="#e85d8a" aria-hidden="true">
           <path d="M8 14s-6-3.9-6-8a4 4 0 0 1 6-3.44A4 4 0 0 1 14 6c0 4.1-6 8-6 8z" />
         </svg>
       ),
     },
     {
       id: "star",
       label: "Star",
       href: "https://github.com/Abrechen2/TravStats",
       icon: (
         <svg width="11" height="11" viewBox="0 0 16 16" fill="#f5a623" aria-hidden="true">
           <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25z" />
         </svg>
       ),
     },
     {
       id: "discord",
       label: "Discord",
       href: "https://discord.gg/CRnjB9f78t",
       icon: (
         <svg width="11" height="11" viewBox="0 0 16 16" fill="#5865F2" aria-hidden="true">
           <path d="M13.545 2.907a13.2 13.2 0 0 0-3.257-1.011.05.05 0 0 0-.052.025c-.141.25-.297.577-.406.833a12.2 12.2 0 0 0-3.658 0 8 8 0 0 0-.412-.833.05.05 0 0 0-.052-.025c-1.125.194-2.22.534-3.257 1.011a.04.04 0 0 0-.021.018C.356 6.024-.213 9.047.066 12.032q.003.022.021.037a13.3 13.3 0 0 0 3.995 2.02.05.05 0 0 0 .056-.019q.463-.63.818-1.329a.05.05 0 0 0-.01-.059l-.018-.011a9 9 0 0 1-1.248-.595.05.05 0 0 1-.02-.066l.015-.019q.127-.095.248-.195a.05.05 0 0 1 .051-.007c2.619 1.196 5.454 1.196 8.041 0a.05.05 0 0 1 .053.007q.121.1.248.195a.05.05 0 0 1-.004.085 8 8 0 0 1-1.249.594.05.05 0 0 0-.03.03.05.05 0 0 0 .003.041c.24.465.515.909.817 1.329a.05.05 0 0 0 .056.019 13.2 13.2 0 0 0 4.001-2.02.05.05 0 0 0 .021-.037c.334-3.451-.559-6.449-2.366-9.106a.03.03 0 0 0-.02-.019m-8.198 7.307c-.789 0-1.438-.724-1.438-1.612s.637-1.613 1.438-1.613c.807 0 1.45.73 1.438 1.613 0 .888-.637 1.612-1.438 1.612m5.316 0c-.788 0-1.438-.724-1.438-1.612s.637-1.613 1.438-1.613c.807 0 1.451.73 1.438 1.613 0 .888-.631 1.612-1.438 1.612" />
         </svg>
       ),
     },
   ];
   ```
4. Replace the desktop `<nav className="hidden xl:flex items-center gap-1">…</nav>`
   block with a renderer over the model. Extract ONE local component inside the file so
   desktop leaves keep today's exact look (accent underline, badge, beta pill):

   ```tsx
   function DesktopLeaf({ node, pathname }: { node: NavLeaf; pathname: string }): JSX.Element {
     const active = isPathActive(node.path, pathname);
     const hasBadge = (node.badge ?? 0) > 0;
     return (
       <Link
         to={node.path}
         aria-current={active ? "page" : undefined}
         className="relative px-3 py-1.5 text-sm transition-colors duration-200 rounded-md"
         style={{
           fontWeight: active ? 600 : 500,
           color: active ? "var(--accent)" : node.warn ? "var(--warning)" : "var(--text-muted)",
           background: active ? "var(--bg-elevated)" : "transparent",
         }}
       >
         {node.label}
         {node.betaBadge && (
           <span className="ml-1.5 inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium leading-none text-amber-700 bg-amber-100 ring-1 ring-inset ring-amber-600/20 dark:text-amber-400 dark:bg-amber-500/10 dark:ring-amber-400/20">
             Beta
           </span>
         )}
         {active && (
           <span
             className="absolute -bottom-px left-2 right-2 h-[3px] rounded-full"
             style={{ background: "var(--accent)" }}
           />
         )}
         {hasBadge && (
           <span
             className="absolute -top-1 -right-1 text-xs font-bold rounded-full h-4 w-4 flex items-center justify-center"
             style={{ background: "var(--danger)", color: "#fff" }}
           >
             {(node.badge ?? 0) > 9 ? "9+" : node.badge}
           </span>
         )}
       </Link>
     );
   }
   ```

   Desktop nav becomes:

   ```tsx
   <nav className="hidden xl:flex items-center gap-1">
     {center.map((node) =>
       node.kind === "group" ? (
         <NavDropdown key={node.id} group={node} />
       ) : (
         <DesktopLeaf key={node.id} node={node} pathname={location.pathname} />
       )
     )}
   </nav>
   ```
5. Right side: keep the Bug button unchanged. Replace the three inline Donate/Star/
   Discord anchors with:
   ```tsx
   <div className="hidden xl:block">
     <NavDropdown label={t("dashboard:nav.support")} externalLinks={supportLinks} align="right" variant="chip" />
   </div>
   ```
   and insert the System node after it (all breakpoints, like the old Settings link was
   reachable on mobile via the panel — System ALSO renders in the mobile panel, Task 4;
   on the desktop bar render):
   ```tsx
   <div className="hidden xl:block">
     {system.kind === "group" ? (
       <NavDropdown group={system} align="right" variant="chip" />
     ) : (
       <Link
         to={system.path}
         className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium"
         style={{ color: "var(--text-muted)", border: "1px solid var(--color-border)" }}
       >
         {system.label}
       </Link>
     )}
   </div>
   ```

- [ ] **Step 5: Run the nav tests + full check**

Run: `npx vitest --run src/__tests__/components/NavigationBar.test.tsx src/components/Nav && npx tsc --noEmit && npm run lint`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/NavigationBar.tsx frontend/src/__tests__/components/NavigationBar.test.tsx frontend/src/i18n/resources/de/dashboard.json frontend/src/i18n/resources/en/dashboard.json
git commit -m "feat(nav): desktop bar uses Logbuch/Support/System submenus (Variante B)"
```

---

### Task 4: NavigationBar mobile panel — labelled groups

**Files:**
- Modify: `frontend/src/components/NavigationBar.tsx` (mobile panel block, lines ~344-385 pre-Task-3)
- Modify: `frontend/src/__tests__/components/NavigationBar.test.tsx` (add mobile cases)

**Interfaces:**
- Consumes: the same `{center, system}` model from Task 3 — the mobile panel maps over it. No new exports.

- [ ] **Step 1: Add the failing mobile tests**

Append to `NavigationBar.test.tsx`:

```tsx
describe("NavigationBar mobile panel", () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ["flight", "cruise"] });
  });

  it("renders Logbuch as a labelled group with indented domain links", () => {
    render(
      <MemoryRouter>
        <NavigationBar />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByLabelText(/toggleMenu|Menü/i));
    // group label is plain text (not a button) in the panel
    expect(screen.getByText(/Logbuch|Logbook/)).toBeTruthy();
    const panelFlights = screen
      .getAllByRole("link", { name: /Flüge|Flights/ })
      .find((el) => el.className.includes("pl-"));
    expect(panelFlights).toBeTruthy();
  });

  it("renders the System group with Einstellungen in the panel", () => {
    render(
      <MemoryRouter>
        <NavigationBar />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByLabelText(/toggleMenu|Menü/i));
    expect(
      screen.getAllByRole("link", { name: /Einstellungen|Settings/ }).length
    ).toBeGreaterThan(0);
  });
});
```

Note: the hamburger's aria-label is `t("common:accessibility.toggleMenu")` — check the
real DE/EN values in `common.json` and adjust the regex to match (the untranslated key
string is also acceptable if the test i18n returns keys).

- [ ] **Step 2: Run to verify the group-label assertion fails**

Run: `npx vitest --run src/__tests__/components/NavigationBar.test.tsx`
Expected: the new mobile cases FAIL (old flat panel has no group label).

- [ ] **Step 3: Rewrite the mobile panel to render the model**

Replace the `{navItems.map(...)}` block inside the mobile `<nav>` with:

```tsx
{center.map((node) =>
  node.kind === "group" ? (
    <div key={node.id}>
      <div
        className="px-3 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        {node.label}
      </div>
      {node.children.map((child) => (
        <MobileLeaf key={child.id} node={child} indent onNavigate={closeMobileMenu} />
      ))}
    </div>
  ) : (
    <MobileLeaf key={node.id} node={node} onNavigate={closeMobileMenu} />
  )
)}
<div className="my-2" style={{ borderTop: "1px solid var(--color-border)" }} />
{system.kind === "group" ? (
  <div>
    <div
      className="px-3 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider"
      style={{ color: "var(--text-muted)" }}
    >
      {system.label}
    </div>
    {system.children.map((child) => (
      <MobileLeaf key={child.id} node={child} indent onNavigate={closeMobileMenu} />
    ))}
  </div>
) : (
  <MobileLeaf node={system} onNavigate={closeMobileMenu} />
)}
```

with one local `MobileLeaf` (replaces the old inline map body, keeps today's exact
row styling):

```tsx
function MobileLeaf({
  node,
  indent = false,
  onNavigate,
}: {
  node: NavLeaf;
  indent?: boolean;
  onNavigate: () => void;
}): JSX.Element {
  const location = useLocation();
  const active = isPathActive(node.path, location.pathname);
  const hasBadge = (node.badge ?? 0) > 0;
  return (
    <Link
      to={node.path}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors ${
        indent ? "pl-7" : ""
      }`}
      style={{
        fontWeight: active ? 600 : 500,
        background: active ? "var(--bg-elevated)" : "transparent",
        color: active ? "var(--accent)" : node.warn ? "var(--warning)" : "var(--text-muted)",
        borderLeft: active ? "3px solid var(--accent)" : "3px solid transparent",
      }}
    >
      <span className="flex items-center gap-1.5">
        {node.label}
        {node.betaBadge && (
          <span className="inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium leading-none text-amber-700 bg-amber-100 ring-1 ring-inset ring-amber-600/20 dark:text-amber-400 dark:bg-amber-500/10 dark:ring-amber-400/20">
            Beta
          </span>
        )}
      </span>
      {hasBadge && (
        <span
          className="text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center"
          style={{ background: "var(--danger)", color: "#fff" }}
        >
          {(node.badge ?? 0) > 9 ? "9+" : node.badge}
        </span>
      )}
    </Link>
  );
}
```

The mobile footer keeps the three support links as today (compact row) — they already
match the "Support group" reading of the spec; add the same group label above them:
`<div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{t("dashboard:nav.support")}</div>`.

- [ ] **Step 4: Run all nav tests**

Run: `npx vitest --run src/__tests__/components/NavigationBar.test.tsx src/components/Nav && npx tsc --noEmit && npm run lint`
Expected: PASS + clean. Also check `NavigationBar.tsx` line count stays under 800:
`(Get-Content frontend/src/components/NavigationBar.tsx | Measure-Object -Line).Lines` — expect well under (target ≈ 350 after the split).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/NavigationBar.tsx frontend/src/__tests__/components/NavigationBar.test.tsx
git commit -m "feat(nav): mobile panel renders labelled Logbuch/System/Support groups"
```

---

### Task 5: Central import hub — domain groups + delete the round-trip tile

**Files:**
- Modify: `frontend/src/components/Settings/ImportSection.tsx`
- Create: `frontend/src/components/Settings/__tests__/ImportSection.test.tsx`
- Delete: `frontend/src/components/import/RoundTripImportTile.tsx`, `frontend/src/components/import/RoundTripImportTile.test.tsx`, `e2e/import.roundtrip.spec.ts`
- Modify: `frontend/src/i18n/resources/de/settings.json` + `en/settings.json`

**Interfaces:**
- Consumes: `AVAILABLE_DOMAINS`, `DOMAINS` (`shared/domains.ts`), `useEnabledDomains`, `Fr24ImportTile`, `GenericCsvImportTile`, `SectionCard`/`SectionTitle` from `./SettingsShared`.
- Produces: `ImportSection` default export unchanged (SettingsPage keeps rendering it for `activeSection === "import"`). Internal registry shape (extension point for future domains):
  ```tsx
  const BULK_IMPORTERS: Partial<Record<DomainKey, JSX.Element[]>> = {
    flight: [<Fr24ImportTile key="fr24" />, <GenericCsvImportTile key="csv" />],
  };
  ```

- [ ] **Step 1: Write the failing test**

`frontend/src/components/Settings/__tests__/ImportSection.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
// The tiles do real file/API work — stub them to markers.
vi.mock("../../import/Fr24ImportTile", () => ({
  Fr24ImportTile: () => <div data-testid="tile-fr24" />,
}));
vi.mock("../../import/GenericCsvImportTile", () => ({
  GenericCsvImportTile: () => <div data-testid="tile-csv" />,
}));
vi.unmock("../../../store/settingsStore");

import ImportSection from "../ImportSection";
import { useSettingsStore } from "../../../store/settingsStore";

describe("ImportSection — central import hub", () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ["flight", "cruise"] });
  });

  it("renders the flight group with exactly the two live tiles", () => {
    render(<ImportSection />);
    expect(screen.getByText("common:domain.flight")).toBeTruthy();
    expect(screen.getByTestId("tile-fr24")).toBeTruthy();
    expect(screen.getByTestId("tile-csv")).toBeTruthy();
  });

  it("renders no round-trip tile", () => {
    render(<ImportSection />);
    expect(screen.queryByText(/roundTrip|reimport/i)).toBeNull();
  });

  it("renders no group for a domain without bulk importers (cruise)", () => {
    render(<ImportSection />);
    expect(screen.queryByText("common:domain.cruise")).toBeNull();
  });

  it("hides the flight group when the flight domain is disabled", () => {
    useSettingsStore.setState({ enabledDomains: ["cruise"] });
    render(<ImportSection />);
    expect(screen.queryByTestId("tile-fr24")).toBeNull();
    expect(screen.queryByText("common:domain.flight")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest --run src/components/Settings/__tests__/ImportSection.test.tsx`
Expected: FAIL — current ImportSection renders three flat tiles, no group headers.

- [ ] **Step 3: Rewrite ImportSection + delete the tile**

`frontend/src/components/Settings/ImportSection.tsx` (full new content):

```tsx
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { AVAILABLE_DOMAINS, DOMAINS, type DomainKey } from "../../shared/domains";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { Fr24ImportTile } from "../import/Fr24ImportTile";
import { GenericCsvImportTile } from "../import/GenericCsvImportTile";

/** Central import hub: one settings area, bulk importers grouped per domain.
 *  Single-record email/PDF parsing deliberately stays in the add dialogs.
 *  A future domain gets a group by adding its tiles here — nothing else. */
const BULK_IMPORTERS: Partial<Record<DomainKey, JSX.Element[]>> = {
  flight: [<Fr24ImportTile key="fr24" />, <GenericCsvImportTile key="csv" />],
};

export default function ImportSection(): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const { isEnabled } = useEnabledDomains();

  const groups = AVAILABLE_DOMAINS.filter(
    (key) => isEnabled(key) && (BULK_IMPORTERS[key]?.length ?? 0) > 0
  );

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:import.title")}
        description={t("settings:import.description")}
      />
      <div className="flex flex-col gap-6">
        {groups.map((key) => (
          <div key={key}>
            <div className="mb-3 flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ background: DOMAINS[key].color }}
              />
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {t(`common:${DOMAINS[key].i18nKey}`)}
              </span>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{BULK_IMPORTERS[key]}</div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
```

Delete the tile + its tests + the e2e spec:

```bash
git rm frontend/src/components/import/RoundTripImportTile.tsx frontend/src/components/import/RoundTripImportTile.test.tsx e2e/import.roundtrip.spec.ts
```

(The backend batch route the tile called stays — API consumers are unaffected.)

- [ ] **Step 4: i18n cleanup (DE + EN together)**

In BOTH `frontend/src/i18n/resources/de/settings.json` and `en/settings.json`:
- Delete the whole `import.tile.roundTrip` object.
- Replace `import.description`:
  - DE: `"Bestehende Daten aus anderen Diensten importieren — pro Bereich gebündelt."`
  - EN: `"Import existing data from other services — grouped per area."`
- Add `import.openHub` (used by Task 6):
  - DE: `"Importieren"`
  - EN: `"Import"`

Then verify no orphaned usages remain:
`grep -rn "roundTrip" frontend/src e2e` → expect ZERO hits.

- [ ] **Step 5: Run tests + full check**

Run: `npx vitest --run src/components/Settings/__tests__/ImportSection.test.tsx && npx tsc --noEmit && npm run lint`
Expected: PASS + clean (tsc catches any straggler import of the deleted tile).

- [ ] **Step 6: Commit**

```bash
git add -A frontend/src/components/Settings frontend/src/i18n/resources/de/settings.json frontend/src/i18n/resources/en/settings.json
git commit -m "feat(import): central domain-grouped import hub; drop dead round-trip tile"
```

---

### Task 6: Flights page links to the hub

**Files:**
- Modify: `frontend/src/pages/FlightsTablePage.tsx` (toolbar block around line 306-317)
- Test: extend `frontend/src/components/Settings/__tests__/ImportSection.test.tsx`? No — the link lives on the flights page; assert it in the page's existing test if one exists, else add a minimal render test `frontend/src/__tests__/pages/FlightsTablePage.importLink.test.tsx`.

**Interfaces:**
- Consumes: `settings:import.openHub` i18n key (Task 5), settings deep link `/settings?section=import` (existing mechanism — `SettingsPage` reads `searchParams.get("section")`).

- [ ] **Step 1: Write the failing test**

`frontend/src/__tests__/pages/FlightsTablePage.importLink.test.tsx` — FlightsTablePage
pulls many stores/APIs; mock at the same level as the existing page tests. If a
FlightsTablePage test already exists, add the assertion there instead of building a new
harness. Minimal standalone variant (adjust mocks to the page's actual imports at
implementation time — the implementer MUST copy the mock preamble from the closest
existing page test, e.g. the flights-table redesign tests):

```tsx
it("links to the central import hub in settings", () => {
  renderFlightsTablePage(); // reuse the existing test harness helper
  const link = screen.getByRole("link", { name: /Importieren|Import/ });
  expect(link.getAttribute("href")).toBe("/settings?section=import");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest --run src/__tests__/pages/FlightsTablePage.importLink.test.tsx`
Expected: FAIL — no such link yet.

- [ ] **Step 3: Add the link**

In `frontend/src/pages/FlightsTablePage.tsx`, in the header flex row next to the
add-flight button (after line ~316), add:

```tsx
<Link
  to="/settings?section=import"
  className="flex items-center gap-2 whitespace-nowrap rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] hover:border-[var(--accent)]"
>
  <span aria-hidden="true">📥</span>
  <span>{t("settings:import.openHub")}</span>
</Link>
```

Add `Link` to the react-router-dom import of the page and `"settings"` to its
`useTranslation` namespaces if missing.

- [ ] **Step 4: Run test + full check**

Run: `npx vitest --run src/__tests__/pages/FlightsTablePage.importLink.test.tsx && npx tsc --noEmit && npm run lint`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/FlightsTablePage.tsx frontend/src/__tests__/pages
git commit -m "feat(import): flights page links to the central import hub"
```

---

### Task 7: Final gate + browser UAT (controller task)

**Files:** none (verification only)

- [ ] **Step 1: Full frontend gate**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run`
Expected: clean, ALL tests green (~1175+).

- [ ] **Step 2: Browser UAT on the dev stack** (nav is exactly the class where green
tests hide a broken-feeling UI — memory `feedback_verify_in_browser_not_api`):

Start dev stack (ports 8000/3000, dev DB 5433), login `admin:admin123`, verify:
- Logbuch dropdown opens/closes (click, Escape, outside, navigation), both domains listed,
  active underline when on /flights.
- Disable the cruise domain in settings → Logbuch collapses to "Flüge" direct link.
- System chip shows Einstellungen/Admin/Parser (admin user); badge appears when a pending
  update exists; Support chip opens Donate/Star/Discord.
- Mobile viewport (≤ xl): hamburger panel shows Logbuch/System groups + Support footer.
- Settings → Import: flight group with FR24 + CSV tiles, NO round-trip tile.
- Flights page: "Importieren" link lands on the import section.

- [ ] **Step 3: Update the SDD ledger; then whole-branch review per the standard flow.**

---

## Self-Review (done at plan time)

- Spec coverage: nav structure (T1+T3), collapse rule incl. System (T1), aria/interaction
  (T2), mobile groups (T4), badge aggregation (T1+T2), import hub grouping + tile deletion
  + i18n cleanup + e2e spec deletion (T5), flights deep link (T6), gates + browser UAT (T7). ✔
- Placeholder scan: Task 6 Step 1 deliberately delegates the mock preamble to the existing
  page-test harness (copying 100 lines of mocks into the plan would drift); the assertion
  itself is concrete. Everything else carries full code. ✔
- Type consistency: `NavLeaf`/`NavGroup`/`NavNode`, `useNavItems(pendingUpdatesCount,
  pathname)`, `isPathActive`, `isNodeActive`, `ExternalLink` used consistently across
  T1-T4; `BULK_IMPORTERS` local to T5. ✔
