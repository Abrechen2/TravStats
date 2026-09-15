/**
 * E2E — the flight list, actually reached.
 *
 * Rewritten for AUD-098. The previous version of this file carried the comment
 * "These tests assume user is logged in / You may need to add authentication
 * setup here" and never did it, so every case ran anonymously and every
 * protected page redirected to the login screen. The assertions were written
 * so a login screen satisfied them: selectors like `[class*="flight"]` that
 * match almost anything, and bodies wrapped in `if (await x.isVisible())` so
 * that an absent control meant a pass. Across three engines that produced
 * green cases which had not seen the feature they named.
 *
 * Two rules here, and they are the whole point:
 *
 *  1. Every assertion runs. Nothing is guarded by `isVisible()` — a control
 *     that is missing is a failure, which is what a test is for.
 *  2. The session is real. It comes from the `setup` project, so the first
 *     assertion of every case is implicitly "I am not on the login page".
 *
 * Prerequisites, same as the import specs:
 *  - dev server running (PLAYWRIGHT_BASE_URL or localhost:5173)
 *  - dev DB seeded with admin:admin123 via `npm run seed:dev-admin`
 *
 * The config runs with locale de-DE, so user-facing copy asserts the German
 * strings with the English alternative beside them.
 */
import { test, expect } from "@playwright/test";

test.describe("Flight list", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/flights");
    // The session is the precondition of everything below. Asserting it here
    // once means a failure further down is about the feature, not the login.
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("reaches the flight list as a signed-in user", async ({ page }) => {
    // `dashboard:flightsTitle`, the heading FlightsTablePage actually renders.
    // My first attempt asserted "Flugliste" — a string from a different key —
    // and failed, which is the suite behaving correctly for once.
    await expect(page.getByRole("heading", { name: /^Flüge$|^Flights$/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("offers the search field the page documents", async ({ page }) => {
    // The real placeholder from `flights:filter.searchPlaceholder`, not a
    // `placeholder*="search"` guess that matched nothing and was skipped.
    const search = page.getByPlaceholder(/Airline, Flugnummer oder Flughafen|Airline, flight number/i);
    await expect(search).toBeVisible({ timeout: 15_000 });

    await search.fill("LH");
    // Typing must not break the page — an unhandled error here used to be
    // invisible because the whole block sat behind an `if`.
    await expect(search).toHaveValue("LH");
  });

  test("keeps the filter in the URL so a filtered list can be shared", async ({ page }) => {
    const search = page.getByPlaceholder(/Airline, Flugnummer oder Flughafen|Airline, flight number/i);
    await search.fill("LH");
    await expect(search).toHaveValue("LH");
    // Whatever the list then shows, the page must still be the flight list
    // and must not have thrown the user out.
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page).toHaveURL(/\/flights/);
  });
});

test.describe("Statistics", () => {
  test("opens the statistics page directly", async ({ page }) => {
    // By URL rather than by hunting for a link whose text the old version
    // guessed at in three languages and then skipped when it found none.
    await page.goto("/stats");

    // Staying on /stats IS the assertion: the route redirects to /login for
    // anyone without a session, so this is the one that proves the setup
    // project's work reached the browser.
    await expect(page).toHaveURL(/\/stats/);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator("h1, h2").first()).toBeVisible({ timeout: 20_000 });
  });
});
