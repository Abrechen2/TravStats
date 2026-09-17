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

const SYNTHETIC_CSV = "Kdate,Kfrom,Kto,Kdep,Karr,Kfn\n2024-01-15,FRA,JFK,10:00:00,13:00:00,LH400";

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

/**
 * Remove what a previous run of this file imported.
 *
 * The synthetic CSV is fixed, so its row accumulates: after two runs the list
 * holds two LH400s and a strict locator refuses to choose between them, and
 * after three the preview reports duplicates instead of a ready row. A test
 * that cannot run twice is one that gets deleted the first time it is
 * inconvenient (CAMPAIGN.md, CAMP-04).
 */
async function removeFixtureFlights(page: import("@playwright/test").Page): Promise<void> {
  const res = await page.request.get("/api/v1/flights?limit=500");
  if (!res.ok()) return;
  const body = (await res.json()) as { flights?: { id: string; flightNumber: string | null }[] };
  for (const flight of (body.flights ?? []).filter((f) => f.flightNumber === "LH400")) {
    await page.request.delete(`/api/v1/flights/${flight.id}`);
  }
}

test("Generic-CSV importer — wizard maps custom columns", async ({ page }) => {
  await loginAsAdmin(page);
  await removeFixtureFlights(page);
  await loginAsAdmin(page);
  await page.goto("/settings");
  await page.click('button:has-text("Import")');
  // Confirm Import section is shown
  // Both locales — see the note in import.fr24.spec.ts.
  await expect(
    page.getByText(/Aus beliebigem Logbuch \(CSV\)|From any logbook \(CSV\)/)
  ).toBeVisible();

  // Upload synthetic CSV — Generic CSV tile label says "Choose CSV file"
  await page.setInputFiles(
    'label:has-text("CSV-Datei auswählen") input[type="file"], label:has-text("Choose CSV file") input[type="file"]',
    tmpCsvPath
  );

  // Column Mapping Wizard must appear
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByText(
      /CSV-Spalten auf TravStats-Felder zuordnen|Map your CSV columns to TravStats fields/i
    )
  ).toBeVisible();

  // The wizard renders required fields first: date (nth=0), fromIata (nth=1), toIata (nth=2)
  // Each <select> starts with the "— skip —" option (value="")
  // Scoped to the WIZARD. A bare `page.locator('select')` also matches the
  // settings section picker — a mobile-only control that is present but hidden
  // on desktop — so `.nth(0)` was the wrong element and the case timed out
  // selecting an option in something invisible.
  const selects = page.getByRole("dialog").locator("select");
  await selects.nth(0).selectOption("Kdate"); // date
  await selects.nth(1).selectOption("Kfrom"); // fromIata
  await selects.nth(2).selectOption("Kto"); // toIata
  // Optional fields (dep/arr time, flight number) — map them for a richer preview
  await selects.nth(3).selectOption("Kdep"); // depTimeLocal
  await selects.nth(4).selectOption("Karr"); // arrTimeLocal
  await selects.nth(5).selectOption("Kfn"); // flightNumber

  // Advance to preview
  await page.click('button:has-text("Weiter"), button:has-text("Continue")');

  // PreviewModal must appear and show 1 ready row
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText(/1 bereit|1 ready/)).toBeVisible();

  // Commit
  await page.click('button:has-text("1 Zeile importieren"), button:has-text("Import 1 row")');

  // WAIT for the commit to report success before leaving the page.
  //
  // The click fires a POST; navigating away while it is in flight aborts it.
  // Firefox and WebKit happened to be slow enough that it landed anyway,
  // Chromium was not — so the same test wrote a flight in two engines and
  // silently wrote nothing in the third, and then failed looking for it.
  await expect(page.getByText(/Import abgeschlossen|Import complete/i)).toBeVisible({
    timeout: 20_000,
  });

  // Verify the flight is now visible on the dashboard
  // The flight LIST, not the dashboard. The dashboard is a map since the
  // multi-domain rework; it shows no flight numbers, so this assertion was
  // looking for the row on a page that never had one.
  await page.goto("/flights");
  // SEARCH for it rather than hoping it is on the first page. The list is
  // paginated and sorted by departure, and the synthetic row is old enough to
  // sit well down it — "not on screen" is not the same as "not imported".
  const search = page.getByPlaceholder(
    /Airline, Flugnummer oder Flughafen|Airline, flight number/i
  );
  await expect(search).toBeVisible({ timeout: 15_000 });
  await search.fill("LH400");
  await expect(page.getByText("LH400").first()).toBeVisible({ timeout: 15_000 });
});
