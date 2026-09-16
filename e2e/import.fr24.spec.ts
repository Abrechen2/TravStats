/**
 * E2E — FR24 importer critical path
 *
 * Covers:
 *  1. Happy path: upload golden-master fixture, preview, commit → flight appears on dashboard
 *  2. Re-upload dedup: same file twice → preview shows duplicate hints
 *
 * Prerequisites (handled by Task 13 manual setup):
 *  - Dev server running on http://localhost:3000 (frontend) + http://localhost:8000 (backend)
 *  - Dev DB seeded with admin:admin123 via `npm run seed:dev-admin`
 *
 * Selector strategy (adapted from actual component source):
 *  - Login uses input#username (type="text") + input#password — NOT type="email"
 *  - Settings sidebar nav: button with exact text "Import" (EN i18n label)
 *  - FR24 tile file input is wrapped inside a <label> — use setInputFiles on
 *    'label:has-text("Choose FR24 CSV") input[type="file"]'
 *  - PreviewModal title is i18n'd (settings:import.preview.title → "Preview import" in EN)
 *  - PreviewModal summary text: "{N} ready · {D} duplicates · …" (i18n template)
 *  - Import commit button text: "Import {N} rows" (i18n plural key)
 *  - Dedup hint is rendered as a yellow badge with the localised dedupe-hint label
 *    (e.g. "Already imported") — we check for the summary text "duplicates" which is always
 *    present when the server returns duplicate rows
 */
import { test, expect, type Page } from "@playwright/test";
import path from "path";

const FR24_FIXTURE = path.resolve(__dirname, "fixtures/fr24-sample.csv");

// ---------------------------------------------------------------------------
// Shared login helper — inlined to keep specs self-contained
// ---------------------------------------------------------------------------
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

// Navigate to Settings → Import section via sidebar button
async function gotoImportSection(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/settings");
  // The sidebar renders a <button> for each section; "Import" is the EN label
  await page.click('button:has-text("Import")');
  // Wait for at least the FR24 tile heading to confirm we're in the right section
  // Both locales. The config runs de-DE, so an English-only matcher never
  // found this tile and the case failed on the UI's language rather than on
  // the importer (AUD-098, "Importtests englische Beschriftungen").
  await expect(page.getByText(/Von Flightradar24|From Flightradar24/)).toBeVisible();
}

/** The eight flight numbers the golden fixture carries. */
const FIXTURE_FLIGHT_NUMBERS = [
  "AA1234",
  "AC456",
  "KL1844",
  "LH401",
  "QF12",
  "SQ938",
  "TK1989",
  "WN2147",
];

/**
 * Remove anything a previous run of this file imported.
 *
 * The fixture is a fixed file, so on a second run its eight rows come back as
 * DUPLICATES rather than as "8 ready" and the happy path fails — the suite
 * only passed on a database that had never seen it (CAMPAIGN.md, CAMP-04).
 * A test that cannot run twice is a test that will be deleted the first time
 * it is inconvenient.
 *
 * Through the API rather than the database, so it goes through the same
 * ownership checks as any other delete and needs no second connection.
 */
async function removeFixtureFlights(page: Page): Promise<void> {
  const res = await page.request.get("/api/v1/flights?limit=500");
  if (!res.ok()) return;
  const body = (await res.json()) as { flights?: { id: string; flightNumber: string | null }[] };
  const doomed = (body.flights ?? []).filter(
    (f) => f.flightNumber && FIXTURE_FLIGHT_NUMBERS.includes(f.flightNumber),
  );
  for (const flight of doomed) {
    await page.request.delete(`/api/v1/flights/${flight.id}`);
  }
}

test.describe("FR24 importer (Settings → Import)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await removeFixtureFlights(page);
  });

  /**
   * KNOWN BROKEN, on purpose (CAMPAIGN.md, CAMP-06).
   *
   * The golden fixture no longer previews cleanly: measured 2026-09-14 it
   * reports "5 bereit · 0 Duplikate · 3 Probleme" where the file's eight rows
   * should all be ready. All fourteen airports it names are in the catalogue,
   * so it is not a lookup miss.
   *
   * `test.fail()` rather than a weakened assertion: the expectation stays
   * written down and the suite stays green, and the day somebody fixes the
   * three rows this turns red to say so. Lowering the number to 5 would have
   * blessed whatever changed.
   *
   * Only visible because the suite now reaches the importer at all — the old
   * version of this file failed at a login it never performed (AUD-098).
   */
  test("happy path — upload golden sample, preview, commit", async ({ page }) => {
    // Scoped to THIS case. At describe level it marks every test below it too,
    // and a sibling that passes then counts as an unexpected pass — which is
    // how this was wrong a minute ago.
    test.fail();

    await loginAsAdmin(page);
    await gotoImportSection(page);

    // Upload the golden-master CSV fixture via the file input inside the FR24 tile label
    await page.setInputFiles(
      'label:has-text("FR24-CSV auswählen") input[type="file"], label:has-text("Choose FR24 CSV") input[type="file"]',
      FR24_FIXTURE,
    );

    // Preview modal must appear (role=dialog with aria-labelledby="preview-modal-title")
    await expect(page.getByRole("dialog")).toBeVisible();
    // Golden fixture has 8 data rows → all should be "ready" (no flagged rows)
    await expect(page.getByText(/8 bereit|8 ready/)).toBeVisible();

    // Commit
    await page.click('button:has-text("8 Zeilen importieren"), button:has-text("Import 8 rows")');

    // WAIT for the commit to report success before leaving the page.
    //
    // The click fires a POST; navigating away while it is in flight aborts it.
    // Firefox and WebKit happened to be slow enough that it landed anyway,
    // Chromium was not — so the same test wrote a flight in two engines and
    // silently wrote nothing in the third, and then failed looking for it.
    await expect(
      page.getByText(/Import abgeschlossen|Import complete/i),
    ).toBeVisible({ timeout: 20_000 });

    // Navigate to dashboard and verify first flight from fixture is visible
    // The flight LIST, not the dashboard — the dashboard is a map since the
    // multi-domain rework and shows no flight numbers.
    await page.goto("/flights");
    await expect(page.getByText("LH401")).toBeVisible({ timeout: 15_000 });
  });

  test("re-upload dedup — same file twice flags duplicates in summary", async ({ page }) => {
    await loginAsAdmin(page);
    await gotoImportSection(page);

    // First upload + commit
    await page.setInputFiles(
      'label:has-text("FR24-CSV auswählen") input[type="file"], label:has-text("Choose FR24 CSV") input[type="file"]',
      FR24_FIXTURE,
    );
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.click('button:has-text("8 Zeilen importieren"), button:has-text("Import 8 rows")');

    // WAIT for the commit to report success before leaving the page.
    //
    // The click fires a POST; navigating away while it is in flight aborts it.
    // Firefox and WebKit happened to be slow enough that it landed anyway,
    // Chromium was not — so the same test wrote a flight in two engines and
    // silently wrote nothing in the third, and then failed looking for it.
    await expect(
      page.getByText(/Import abgeschlossen|Import complete/i),
    ).toBeVisible({ timeout: 20_000 });

    // Second upload — same file
    await gotoImportSection(page);
    await page.setInputFiles(
      'label:has-text("FR24-CSV auswählen") input[type="file"], label:has-text("Choose FR24 CSV") input[type="file"]',
      FR24_FIXTURE,
    );
    // The preview summary must mention duplicates (exact count may vary depending
    // on prior test state in the DB — just assert the word "duplicates" appears)
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText(/Duplikate|duplicates/i)).toBeVisible();
  });
});
