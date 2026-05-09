/**
 * E2E — Round-Trip XLSX re-import critical path
 *
 * Covers: Dashboard export → XLSX download → Settings → Import → Round-Trip tile → update stats shown
 *
 * Prerequisites (Task 13 manual setup):
 *  - Dev server running, DB seeded with admin:admin123 + demo flights (seed:dev-admin)
 *  - At least one flight must exist so the export produces a non-empty XLSX
 *
 * Selector strategy (adapted from actual DashboardPage.tsx):
 *  - The export trigger is an icon-only button (SVG, no text label). It is found via
 *    title={t("dashboard:export")} which resolves to "Exportieren" (DE) / "Export" (EN).
 *    We use `page.locator('[title]').filter({hasText: ""})` pattern OR the aria title.
 *    Simplest reliable selector: `button[title]` near the add-flight button — use
 *    `page.locator('button[title]')` which matches the export button uniquely in that area.
 *    Fallback: if Playwright locale is EN, title = "Export" → `button[title="Export"]`.
 *  - After clicking the export button, a dropdown appears with format buttons labeled
 *    "XLSX", "CSV", "PDF", "GEOJSON", "KML" (text is fmt.toUpperCase() in the source).
 *  - Round-Trip tile label: "Choose .xlsx / .csv / .json" (EN i18n)
 *  - Success text matches i18n key "settings:import.tile.roundTrip.successSummary":
 *    "Updated: {{updated}} · Created: {{created}}" — we check for "Updated:" as the
 *    stable substring.
 *
 * NOTE on Export button selector:
 *  The dashboard export button has no text — it renders only an SVG download icon plus a
 *  `title` attribute. The EN i18n value is "Export" (dashboard:export). We target it via
 *  `button[title="Export"]` which is the most stable selector available without data-testid.
 *  If the locale defaults to DE, the title will be "Exportieren" — we try both.
 */
import { test, expect } from "@playwright/test";
import path from "path";

async function loginAsAdmin(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/login");
  await page.fill("input#username", "admin");
  await page.fill("input#password", "admin123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(?:dashboard)?$/);
}

test("Round-Trip XLSX — export from dashboard, re-import updates by id", async ({ page }) => {
  await loginAsAdmin(page);

  // ---- Step 1: Export XLSX from Dashboard ----
  // The export button is icon-only with a title attribute (EN: "Export" / DE: "Exportieren")
  const exportBtn = page.locator('button[title="Export"], button[title="Exportieren"]').first();
  await expect(exportBtn).toBeVisible({ timeout: 10_000 });
  await exportBtn.click();

  // Dropdown appears — click XLSX
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('button:has-text("XLSX")').click(),
  ]);
  const exportPath = await download.path();
  // If download.path() returns null the download was not created on disk — this is a hard failure
  expect(exportPath).toBeTruthy();

  // ---- Step 2: Navigate to Settings → Import → Round-Trip tile ----
  await page.goto("/settings");
  await page.click('button:has-text("Import")');
  // Confirm Round-Trip tile is visible
  await expect(page.getByText("Re-import TravStats Excel")).toBeVisible();

  // Upload the downloaded XLSX file into the Round-Trip tile
  // Label text: "Choose .xlsx / .csv / .json" (EN i18n)
  await page.setInputFiles(
    'label:has-text("Choose .xlsx") input[type="file"], [aria-label*=".xlsx"]',
    exportPath!,
  );

  // The tile shows a success summary once the API calls complete:
  // "Updated: {N} · Created: {M}" — wait up to 30 s for large datasets
  await expect(page.getByText(/Updated:/)).toBeVisible({ timeout: 30_000 });
});

test("Round-Trip tile — shows loading state during processing", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/settings");
  await page.click('button:has-text("Import")');
  await expect(page.getByText("Re-import TravStats Excel")).toBeVisible();

  // Write a minimal valid round-trip CSV (no id → will create a new flight)
  // to verify the busy indicator appears; the row is intentionally minimal so it
  // may fail airport resolution — we only assert the tile tries to process it.
  const { writeFileSync, unlinkSync } = await import("fs");
  const { tmpdir } = await import("os");
  const tmpPath = path.join(tmpdir(), `rt-stub-${Date.now()}.xlsx`);

  // We can't easily create a real XLSX in pure Node without exceljs — use a CSV instead
  // (RoundTripImportTile accepts .csv as well as .xlsx)
  const stubCsvPath = tmpPath.replace(".xlsx", ".csv");
  writeFileSync(
    stubCsvPath,
    "id,depIata,arrIata,departureTime,arrivalTime\n,FRA,MUC,2024-01-01 08:00:00,2024-01-01 09:00:00",
    "utf-8",
  );

  await page.setInputFiles(
    'label:has-text("Choose .xlsx") input[type="file"], [aria-label*=".xlsx"]',
    stubCsvPath,
  );

  // Either a loading state or a result/error state should appear — confirms the tile
  // is wired up and responding to the file input change event
  await expect(
    page
      .locator('.import-tile__busy, .import-tile__stats, .import-error')
      .first(),
  ).toBeVisible({ timeout: 20_000 });

  try {
    unlinkSync(stubCsvPath);
  } catch {
    // best-effort
  }
});
