import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Auth helper — matches the login form in LoginPage.tsx
// LoginPage uses input#username (type="text") and input#password.
// Dev DB credentials: admin / admin123 (see CLAUDE.local.md).
// ---------------------------------------------------------------------------
async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/login");
  await page.fill("input#username", "admin");
  await page.fill("input#password", "admin123");
  await page.click("button[type='submit']");
  // Wait until we land on any dashboard route.
  await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Multi-domain dashboard E2E
// ---------------------------------------------------------------------------
test.describe("Multi-domain dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  // -------------------------------------------------------------------------
  // 1. Default route lands on All tab (aria-selected="true") with overview mode
  // -------------------------------------------------------------------------
  test("default lands on All tab with overview mode", async ({ page }) => {
    await page.goto("/dashboard");

    // The DomainTabStrip renders buttons with role="tab".
    // i18n key dashboard:tabStrip.tabs.all = "Alle"
    const allTab = page.getByRole("tab", { name: /alle/i });
    await expect(allTab).toBeVisible({ timeout: 8_000 });
    await expect(allTab).toHaveAttribute("aria-selected", "true");

    // URL should be exactly /dashboard (no extra segment).
    await expect(page).toHaveURL(/\/dashboard$/);

    // Default mode for "all" is "overview" — mode button shows "Modus: Übersicht".
    const modeBtn = page.getByRole("button", { name: /modus/i });
    await expect(modeBtn).toBeVisible();
    await expect(modeBtn).toContainText(/übersicht/i);
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

    // Mode button should reflect the active mode.
    const modeBtn = page.getByRole("button", { name: /modus/i });
    await expect(modeBtn).toBeVisible();
    await expect(modeBtn).toContainText(/itinerar/i);
  });

  // -------------------------------------------------------------------------
  // 4. Mode change updates the URL and persists across a full page reload
  // -------------------------------------------------------------------------
  test("mode change updates URL and persists across reload", async ({ page }) => {
    await page.goto("/dashboard/flight");

    // Open the mode dropdown (DashboardControlsBar).
    const modeBtn = page.getByRole("button", { name: /modus/i });
    await modeBtn.click();

    // Pick "Heatmap" from the menu (dashboard:modes.heatmap = "Heatmap").
    const heatmapItem = page.getByRole("menuitem", { name: /heatmap/i });
    await expect(heatmapItem).toBeVisible({ timeout: 5_000 });
    await heatmapItem.click();

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

    // The mode button should show heatmap (restored from localStorage).
    const modeBtn = page.getByRole("button", { name: /modus/i });
    await expect(modeBtn).toContainText(/heatmap/i);
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
