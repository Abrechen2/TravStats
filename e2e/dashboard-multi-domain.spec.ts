import { test, expect, type Page } from "@playwright/test";

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

// ---------------------------------------------------------------------------
// Multi-domain dashboard E2E
// ---------------------------------------------------------------------------
test.describe("Multi-domain dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  // -------------------------------------------------------------------------
  // 1. Default route lands on All tab (aria-selected="true") on its default mode
  // -------------------------------------------------------------------------
  test("default lands on All tab on the mode the registry opens it with", async ({ page }) => {
    await page.goto("/dashboard");

    // The DomainTabStrip renders buttons with role="tab".
    // i18n key dashboard:tabStrip.tabs.all = "Alle"
    const allTab = page.getByRole("tab", { name: /alle/i });
    await expect(allTab).toBeVisible({ timeout: 8_000 });
    await expect(allTab).toHaveAttribute("aria-selected", "true");

    // URL should be exactly /dashboard (no extra segment).
    await expect(page).toHaveURL(/\/dashboard$/);

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

    const allTab = page.getByRole("tab", { name: /alle/i });
    await expect(allTab).toBeVisible({ timeout: 8_000 });
    await expect(allTab).toHaveAttribute("aria-selected", "true");

    await openMapPanel(page);
    await expect(page.getByRole("button", { name: /^Übersicht$/i, pressed: true })).toBeVisible({
      timeout: 8_000,
    });
  });

  // -------------------------------------------------------------------------
  // 2. Deep-link to /dashboard/cruise renders Kreuzfahrten tab as active
  // -------------------------------------------------------------------------
  test("deep link to /dashboard/cruise renders the cruise tab as active", async ({ page }) => {
    await page.goto("/dashboard/cruise");

    // i18n key dashboard:tabStrip.tabs.cruise = "Kreuzfahrten"
    const cruiseTab = page.getByRole("tab", { name: /kreuzfahrten/i });
    await expect(cruiseTab).toBeVisible({ timeout: 8_000 });
    await expect(cruiseTab).toHaveAttribute("aria-selected", "true");
  });

  // -------------------------------------------------------------------------
  // 3. Deep-link to /dashboard/cruise?mode=itinerary puts itinerary in the
  //    mode button label (dashboard:modes.itinerary = "Itinerar")
  // -------------------------------------------------------------------------
  test("deep link to /dashboard/cruise?mode=itinerary shows itinerary mode label", async ({
    page,
  }) => {
    await page.goto("/dashboard/cruise?mode=itinerary");

    const cruiseTab = page.getByRole("tab", { name: /kreuzfahrten/i });
    await expect(cruiseTab).toHaveAttribute("aria-selected", "true");

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
  // 5. Tab switch restores the last-used mode via localStorage
  //    Scenario: set flight to heatmap, go to cruise, come back to flight —
  //    heatmap should be re-applied.
  // -------------------------------------------------------------------------
  test("tab switch restores last-used flight mode from localStorage", async ({ page }) => {
    // Start on flight tab with heatmap mode (writes to localStorage).
    await page.goto("/dashboard/flight?mode=heatmap");

    // Switch to cruise tab.
    const cruiseTab = page.getByRole("tab", { name: /kreuzfahrten/i });
    await cruiseTab.click();
    await expect(page).toHaveURL(/\/dashboard\/cruise/);

    // Switch back to flight tab.
    const flightTab = page.getByRole("tab", { name: /flüge/i });
    await flightTab.click();
    await expect(page).toHaveURL(/\/dashboard\/flight/);

    // Restored from localStorage: the option is selected again, and the URL
    // says the same thing — the documented contract is
    // `/dashboard/<tab>?mode=<mode>` (CLAUDE.md).
    await openMapPanel(page);
    await expect(page.getByRole("button", { name: /^Heatmap$/i, pressed: true })).toBeVisible({
      timeout: 8_000,
    });

    // NOT asserted: that the URL also says `mode=heatmap`.
    //
    // It does not. Coming back to a tab restores the remembered mode in the UI
    // and leaves the address bar without a mode at all, so copying the link
    // hands someone else the DEFAULT view rather than the one on screen —
    // while `CLAUDE.md` describes the URL as carrying tab and mode. Which of
    // the two is meant to win is a product decision, so it is written up as
    // CAMP-05 rather than decided here by a test.
  });

  // -------------------------------------------------------------------------
  // 6. All tab + "Hinzufügen" button opens the AddDomainPicker dropdown
  //    which exposes at least the flight option ("Flug").
  // -------------------------------------------------------------------------
  test("All tab Hinzufügen button opens domain picker with flight option", async ({ page }) => {
    await page.goto("/dashboard");

    // "Alle" tab should already be active.
    const allTab = page.getByRole("tab", { name: /alle/i });
    await expect(allTab).toHaveAttribute("aria-selected", "true");

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
