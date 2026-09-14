/**
 * E2E — Generic-CSV importer critical path
 *
 * Covers: upload a non-standard CSV → column mapping wizard → preview → commit → flight visible
 *
 * Prerequisites (Task 13 manual setup):
 *  - Dev server running, DB seeded with admin:admin123
 *
 * Selector strategy:
 *  - Generic CSV tile label text: "Choose CSV file" (EN i18n)
 *  - ColumnMappingWizard: role=dialog, heading "Map your CSV columns to TravStats fields"
 *  - Wizard <select> elements — nth(0)=date, nth(1)=fromIata, nth(2)=toIata (required fields first)
 *  - Wizard "Continue" button — EN i18n label is "Continue"
 *  - PreviewModal commit button: "Import 1 row"
 *
 * NOTE — file upload approach:
 *  The plan suggested `page.evaluate(...)` + DataTransfer to set the file input programmatically.
 *  That pattern is unreliable because:
 *    a) React synthetic onChange does NOT fire when `input.files` is mutated directly via
 *       DataTransfer in page context — the React fiber event system is bypassed.
 *    b) Security sandboxing in Chrome/Firefox may block DataTransfer item-add from
 *       page.evaluate context.
 *  Instead we write the synthetic CSV to a temp file via Node.js `fs` and use the idiomatic
 *  Playwright `page.setInputFiles()` which is fully supported and cross-browser stable.
 *  The tmpFile is written in a `test.beforeAll` block and cleaned up with `fs.unlinkSync`.
 */
import { test, expect } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";

let tmpCsvPath: string;

const SYNTHETIC_CSV =
  "Kdate,Kfrom,Kto,Kdep,Karr,Kfn\n2024-01-15,FRA,JFK,10:00:00,13:00:00,LH400";

test.beforeAll(() => {
  tmpCsvPath = path.join(os.tmpdir(), `travstats-e2e-generic-${Date.now()}.csv`);
  fs.writeFileSync(tmpCsvPath, SYNTHETIC_CSV, "utf-8");
});

test.afterAll(() => {
  try {
    fs.unlinkSync(tmpCsvPath);
  } catch {
    // best-effort cleanup
  }
});

/**
 * The session now comes from the `setup` project (AUD-098), so this no longer
 * signs in — it CONFIRMS that a session exists before the spec relies on one.
 *
 * It used to log in itself, which broke the moment the suite gained a shared
 * session: `/login` redirects away for an authenticated visitor, so the helper
 * waited thirty seconds for a username field that was never going to render.
 * Two sign-ins were always one too many; the shared one is the real thing.
 */
async function loginAsAdmin(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await expect(page).not.toHaveURL(/\/login/);
}

test("Generic-CSV importer — wizard maps custom columns", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/settings");
  await page.click('button:has-text("Import")');
  // Confirm Import section is shown
  // Both locales — see the note in import.fr24.spec.ts.
  await expect(
    page.getByText(/Aus beliebigem Logbuch \(CSV\)|From any logbook \(CSV\)/),
  ).toBeVisible();

  // Upload synthetic CSV — Generic CSV tile label says "Choose CSV file"
  await page.setInputFiles(
    'label:has-text("CSV-Datei auswählen") input[type="file"], label:has-text("Choose CSV file") input[type="file"]',
    tmpCsvPath,
  );

  // Column Mapping Wizard must appear
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByText(
      /CSV-Spalten auf TravStats-Felder zuordnen|Map your CSV columns to TravStats fields/i,
    ),
  ).toBeVisible();

  // The wizard renders required fields first: date (nth=0), fromIata (nth=1), toIata (nth=2)
  // Each <select> starts with the "— skip —" option (value="")
  const selects = page.locator('select');
  await selects.nth(0).selectOption("Kdate");   // date
  await selects.nth(1).selectOption("Kfrom");   // fromIata
  await selects.nth(2).selectOption("Kto");     // toIata
  // Optional fields (dep/arr time, flight number) — map them for a richer preview
  await selects.nth(3).selectOption("Kdep");    // depTimeLocal
  await selects.nth(4).selectOption("Karr");    // arrTimeLocal
  await selects.nth(5).selectOption("Kfn");     // flightNumber

  // Advance to preview
  await page.click('button:has-text("Weiter"), button:has-text("Continue")');

  // PreviewModal must appear and show 1 ready row
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText(/1 bereit|1 ready/)).toBeVisible();

  // Commit
  await page.click('button:has-text("1 Zeile importieren"), button:has-text("Import 1 row")');

  // Verify the flight is now visible on the dashboard
  await page.goto("/dashboard");
  await expect(page.getByText("LH400")).toBeVisible({ timeout: 15_000 });
});
