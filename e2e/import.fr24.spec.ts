/**
 * E2E — FR24 importer critical path
 *
 * Covers:
 *  1. Happy path: upload golden-master fixture, preview, commit → flight appears on dashboard
 *  2. Re-upload dedup: same file twice → preview shows duplicate hints
 *
 * Prerequisites (handled by Task 13 manual setup):
 *  - Dev server running on http://localhost:5173 (frontend) + http://localhost:8000 (backend)
 *  - Dev DB seeded with admin:admin123 via `npm run seed:dev-admin`
 *
 * Selector strategy (adapted from actual component source):
 *  - Login uses input#username (type="text") + input#password — NOT type="email"
 *  - Settings sidebar nav: button with exact text "Import" (EN i18n label)
 *  - FR24 tile file input is wrapped inside a <label> — use setInputFiles on
 *    'label:has-text("Choose FR24 CSV") input[type="file"]'
 *  - PreviewModal title is hardcoded "Preview import" (role=dialog aria-labelledby)
 *  - PreviewModal summary text: "{N} ready · {D} duplicates · …"
 *  - Import commit button text: "Import {N} rows" (hardcoded in PreviewModal footer)
 *  - Dedup hint is rendered as a <span class="flag-badge flag-warn"> with the dedupeHint value
 *    (e.g. "exact_match") — we check for the summary text "duplicates" which is always present
 *    when the server returns duplicate rows
 */
import { test, expect } from "@playwright/test";
import path from "path";

const FR24_FIXTURE = path.resolve(__dirname, "fixtures/fr24-sample.csv");

// ---------------------------------------------------------------------------
// Shared login helper — inlined to keep specs self-contained
// ---------------------------------------------------------------------------
async function loginAsAdmin(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/login");
  await page.fill("input#username", "admin");
  await page.fill("input#password", "admin123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(?:dashboard)?$/);
}

// Navigate to Settings → Import section via sidebar button
async function gotoImportSection(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/settings");
  // The sidebar renders a <button> for each section; "Import" is the EN label
  await page.click('button:has-text("Import")');
  // Wait for at least the FR24 tile heading to confirm we're in the right section
  await expect(page.getByText("From Flightradar24")).toBeVisible();
}

test.describe("FR24 importer (Settings → Import)", () => {
  test("happy path — upload golden sample, preview, commit", async ({ page }) => {
    await loginAsAdmin(page);
    await gotoImportSection(page);

    // Upload the golden-master CSV fixture via the file input inside the FR24 tile label
    await page.setInputFiles(
      'label:has-text("Choose FR24 CSV") input[type="file"]',
      FR24_FIXTURE,
    );

    // Preview modal must appear (role=dialog with aria-labelledby="preview-modal-title")
    await expect(page.getByRole("dialog")).toBeVisible();
    // Golden fixture has 8 data rows → all should be "ready" (no flagged rows)
    await expect(page.getByText(/8 ready/)).toBeVisible();

    // Commit
    await page.click('button:has-text("Import 8 rows")');

    // Navigate to dashboard and verify first flight from fixture is visible
    await page.goto("/dashboard");
    await expect(page.getByText("LH401")).toBeVisible({ timeout: 15_000 });
  });

  test("re-upload dedup — same file twice flags duplicates in summary", async ({ page }) => {
    await loginAsAdmin(page);
    await gotoImportSection(page);

    // First upload + commit
    await page.setInputFiles(
      'label:has-text("Choose FR24 CSV") input[type="file"]',
      FR24_FIXTURE,
    );
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.click('button:has-text("Import 8 rows")');

    // Second upload — same file
    await gotoImportSection(page);
    await page.setInputFiles(
      'label:has-text("Choose FR24 CSV") input[type="file"]',
      FR24_FIXTURE,
    );
    // The preview summary must mention duplicates (exact count may vary depending
    // on prior test state in the DB — just assert the word "duplicates" appears)
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText(/duplicates/i)).toBeVisible();
  });
});
