import { test, expect, type Locator, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// The session comes from the `setup` project (AUD-098), so this confirms one
// exists rather than creating a second. Signing in here broke as soon as the
// suite gained a shared session: `/login` redirects an authenticated visitor
// away, so the helper waited for a username field that never rendered.
// ---------------------------------------------------------------------------
async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/dashboard");
  await expect(page).not.toHaveURL(/\/login/);
}

/**
 * Open the map control panel, which holds the mode selector.
 *
 * It starts COLLAPSED (`loadMapAppearance().panelExpanded ?? false`), so the
 * mode buttons are not in the document at all until it is opened. The tests in
 * this file were written against a "Modus: …" dropdown that used to sit in the
 * controls bar; that control is retired, and its replacement lives in here.
 */
async function openMapPanel(page: Page): Promise<void> {
  const header = page.getByRole("button", { name: /^(Karte|Map)$/ });
  await expect(header).toBeVisible({ timeout: 8_000 });
  if ((await header.getAttribute("aria-expanded")) !== "true") {
    await header.click();
    await expect(header).toHaveAttribute("aria-expanded", "true");
  }
}

/**
 * Open the domain filter ("Domänen · n/m") and return its panel.
 *
 * The domain tab strip is hidden (owner, 2026-09-28): the six-row domain
 * filter answers "what is on the map" in its place, and its "Nur" button is
 * the in-page way into a single-domain view. A single-domain view IS a
 * selection of one, so the filter's ticks are how the page says which view is
 * active — the job `aria-selected` on the strip's tabs used to do.
 */
async function openDomainFilter(page: Page): Promise<Locator> {
  const button = page.getByRole("button", { name: /^(Domänen|Domains) · \d+\/\d+$/ });
  await expect(button).toBeVisible({ timeout: 8_000 });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  const panel = page.getByRole("dialog", { name: /^(Auf der Karte|On the map)$/ });
  await expect(panel).toBeVisible();
  return panel;
}

/** A domain row in the open filter panel — `role="checkbox"`, named by its domain. */
function domainRow(panel: Locator, name: RegExp): Locator {
  return panel.getByRole("checkbox", { name });
}

const FLIGHTS = /^(Flüge|Flights)$/;
const CRUISES = /^(Kreuzfahrten|Cruises)$/;

async function closeDomainFilter(page: Page, panel: Locator): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
}

/** "Alle": every domain on the map, flights and cruises among them. */
async function expectAllDomainsShown(page: Page): Promise<void> {
  const panel = await openDomainFilter(page);
  await expect(domainRow(panel, FLIGHTS)).toHaveAttribute("aria-checked", "true");
  await expect(domainRow(panel, CRUISES)).toHaveAttribute("aria-checked", "true");
  await expect(panel.getByRole("checkbox", { checked: false })).toHaveCount(0);
  await closeDomainFilter(page, panel);
}

/** A single-domain view: its own row ticked, every other row not. */
async function expectOnlyDomainShown(page: Page, name: RegExp): Promise<void> {
  const panel = await openDomainFilter(page);
  await expect(domainRow(panel, name)).toHaveAttribute("aria-checked", "true");
  await expect(panel.getByRole("checkbox", { checked: true })).toHaveCount(1);
  await closeDomainFilter(page, panel);
}

/** "Nur" in a domain's row: the door into that domain's own view. */
async function showOnly(page: Page, name: RegExp): Promise<void> {
  const panel = await openDomainFilter(page);
  await domainRow(panel, name)
    .getByRole("button", { name: /^(Nur|Only)$/ })
    .click();
  // The route change remounts the page (App keys its animated routes on the
  // path), and the outgoing page keeps its open panel until it has left. Wait
  // for that, or the next `openDomainFilter` finds the old page's open panel,
  // skips the click, and holds a panel that is about to detach.
  await expect(panel).toBeHidden();
}

// ---------------------------------------------------------------------------
// Multi-domain dashboard E2E
// ---------------------------------------------------------------------------
test.describe("Multi-domain dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  // -------------------------------------------------------------------------
  // 1. Default route lands on "Alle" (every domain ticked) on its default mode
  // -------------------------------------------------------------------------
  test("default lands on All tab on the mode the registry opens it with", async ({ page }) => {
    await page.goto("/dashboard");

    // URL should be exactly /dashboard (no extra segment), and every domain
    // is on the map.
    await expect(page).toHaveURL(/\/dashboard$/);
    await expectAllDomainsShown(page);

    // The mode control is a segmented row of buttons in the map chrome, not the
    // "Modus: …" dropdown this file was written against — that one is retired.
    // Which option is chosen is now readable via `aria-pressed`.
    // Which mode that is stopped being a constant on 2026-09-20: the owner
    // ruled the globe every tab's default ("Globus soll ueberall genutzt
    // werden"), and `defaultModeForTab` keeps the flat "Uebersicht" for a
    // device without WebGL2 - which this engine may or may not have. So the
    // assertion names both legitimate answers rather than pinning the one this
    // runner happens to give; what it holds is that the control shows a
    // pressed mode at all, and that it is one the registry allows.
    await openMapPanel(page);
    await expect(
      page.getByRole("button", { name: /^(Globus|Übersicht)$/i, pressed: true })
    ).toBeVisible({
      timeout: 8_000,
    });
  });

  // -------------------------------------------------------------------------
  // 1b. The All tab's flat mode is still reachable and the URL still carries
  //     it - the half of case 1 that the globe default took away.
  // -------------------------------------------------------------------------
  test("deep link to /dashboard?mode=overview shows the flat overview mode", async ({ page }) => {
    await page.goto("/dashboard?mode=overview");

    await expectAllDomainsShown(page);

    await openMapPanel(page);
    await expect(page.getByRole("button", { name: /^Übersicht$/i, pressed: true })).toBeVisible({
      timeout: 8_000,
    });
  });

  // -------------------------------------------------------------------------
  // 2. Deep-link to /dashboard/cruise still resolves to the cruise view — the
  //    tab ROUTES outlived the strip (owner, 2026-09-28), so a bookmark into
  //    a single-domain view keeps working.
  // -------------------------------------------------------------------------
  test("deep link to /dashboard/cruise renders the cruise tab as active", async ({ page }) => {
    await page.goto("/dashboard/cruise");

    await expect(page).toHaveURL(/\/dashboard\/cruise$/);
    // The view's own "+" names its domain; "Alle" offers a picker instead.
    await expect(
      page.getByRole("button", { name: /Kreuzfahrt hinzufügen|Add cruise/i })
    ).toBeVisible({ timeout: 8_000 });
    await expectOnlyDomainShown(page, CRUISES);
  });

  // -------------------------------------------------------------------------
  // 3. Deep-link to /dashboard/cruise?mode=itinerary puts itinerary in the
  //    mode button label (dashboard:modes.itinerary = "Itinerar")
  // -------------------------------------------------------------------------
  test("deep link to /dashboard/cruise?mode=itinerary shows itinerary mode label", async ({
    page,
  }) => {
    await page.goto("/dashboard/cruise?mode=itinerary");

    await expectOnlyDomainShown(page, CRUISES);

    // The deep-linked mode is the selected option, and the URL keeps saying so.
    await openMapPanel(page);
    await expect(page.getByRole("button", { name: /^Itinerar$/i, pressed: true })).toBeVisible({
      timeout: 8_000,
    });
    await expect(page).toHaveURL(/mode=itinerary/);
  });

  // -------------------------------------------------------------------------
  // 4. Mode change updates the URL and persists across a full page reload
  // -------------------------------------------------------------------------
  test("mode change updates URL and persists across reload", async ({ page }) => {
    await page.goto("/dashboard/flight");

    // The segmented control, not a dropdown menu.
    await openMapPanel(page);
    const heatmap = page.getByRole("button", { name: /^Heatmap$/i });
    await expect(heatmap).toBeVisible({ timeout: 8_000 });
    await heatmap.click();
    await expect(heatmap).toHaveAttribute("aria-pressed", "true");

    // URL should now carry ?mode=heatmap.
    await expect(page).toHaveURL(/mode=heatmap/);

    // Reload and verify the URL still carries the mode param.
    await page.reload();
    await expect(page).toHaveURL(/mode=heatmap/);
  });

  // -------------------------------------------------------------------------
  // 5. Switching views restores the last-used mode via localStorage
  //    Scenario: set flight to heatmap, go to cruise, come back to flight —
  //    heatmap should be re-applied. The switch goes through the domain
  //    filter's "Nur", the in-page way between single-domain views since the
  //    tab strip was hidden (owner, 2026-09-28).
  // -------------------------------------------------------------------------
  test("tab switch restores last-used flight mode from localStorage", async ({ page }) => {
    // Start on flight tab with heatmap mode (writes to localStorage).
    await page.goto("/dashboard/flight?mode=heatmap");
    await expect(page).toHaveURL(/[?&]mode=heatmap/);

    // Cruises alone.
    await showOnly(page, CRUISES);
    await expect(page).toHaveURL(/\/dashboard\/cruise/);

    // Back to flights alone.
    await showOnly(page, FLIGHTS);
    await expect(page).toHaveURL(/\/dashboard\/flight/);

    // Restored from localStorage: the option is selected again, and the URL
    // says the same thing — the documented contract is
    // `/dashboard/<tab>?mode=<mode>` (CLAUDE.md).
    await openMapPanel(page);
    await expect(page.getByRole("button", { name: /^Heatmap$/i, pressed: true })).toBeVisible({
      timeout: 8_000,
    });

    // And the address says it too (CAMP-05, fixed 2026-09-24): a restored
    // mode used to leave the bar without one, so a copied link handed someone
    // else the default view instead of the one on screen.
    await expect(page).toHaveURL(/[?&]mode=heatmap/);
  });

  // -------------------------------------------------------------------------
  // 6. All tab + "Hinzufügen" button opens the AddDomainPicker dropdown
  //    which exposes at least the flight option ("Flug").
  // -------------------------------------------------------------------------
  test("All tab Hinzufügen button opens domain picker with flight option", async ({ page }) => {
    await page.goto("/dashboard");

    // "Alle" should already be active — the picker is its button; a
    // single-domain view has a "+ <domain> hinzufügen" button instead.
    await expect(page).toHaveURL(/\/dashboard$/);
    await expectAllDomainsShown(page);

    // Click the "+ Hinzufügen ▾" button.
    // The button text is `+ ${t("dashboard:addPicker.button")} ▾` = "+ Hinzufügen ▾"
    const addBtn = page.getByRole("button", { name: /hinzufügen/i });
    await expect(addBtn).toBeVisible({ timeout: 5_000 });
    await addBtn.click();

    // The picker dropdown should reveal at least the flight menu item.
    // dashboard:addPicker.flight = "Flug"
    const flugItem = page.getByRole("menuitem", { name: /flug/i });
    await expect(flugItem).toBeVisible({ timeout: 5_000 });
  });
});
