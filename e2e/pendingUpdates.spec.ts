/**
 * E2E — the pending flight updates page.
 *
 * Rewritten for AUD-098. What this file used to be is the clearest example of
 * the finding: it carried the comment "These tests assume user is logged in /
 * You may need to add authentication setup here" and never did it, so every
 * case ran anonymously against a login redirect. Fifteen assertions sat behind
 * `if (await control.isVisible())`, which turns an absent control into a pass,
 * and one line read
 *
 *     expect(badgeVisible || true).toBe(true); // Always pass, badge might be hidden
 *
 * — a test that cannot fail, saying so in its own comment. Together with
 * `flights.spec.ts` these two files produced 42 green browser cases that had
 * not reached the feature they named, while the cases that genuinely looked at
 * a list failed in all three engines.
 *
 * The rule now: an assertion either runs or the case is SKIPPED with a reason.
 * A suite that cannot set up its data says so in its own report instead of
 * reporting a pass.
 *
 * Prerequisites:
 *  - dev server running (PLAYWRIGHT_BASE_URL or localhost:3000)
 *  - dev DB seeded with admin:admin123 via `npm run seed:dev-admin`
 *
 * The config runs with locale de-DE, so user-facing copy asserts the German
 * strings with the English alternative beside them.
 */
import { test, expect } from "@playwright/test";

/**
 * Everything below this line needs a pending update to exist, and nothing in
 * this repository can create one from the outside: a suggestion is written by
 * the auto-update service after a provider lookup, and there is no fixture
 * endpoint for it.
 *
 * Skipped explicitly, with the reason, rather than written as a conditional
 * that passes when the data is absent. The skip is visible in the report; the
 * conditional was not, and that is the whole difference.
 */
const NEEDS_A_SUGGESTION =
  "needs a seeded pending update; no fixture route exists to create one (AUD-098)";

test.describe("Pending updates page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/pending-updates");
    // The session is the precondition of everything below.
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("is reachable and names itself", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /^Posteingang$|^Inbox$/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("names the section these suggestions live in", async ({ page }) => {
    // The page is the Inbox, and flight updates are one of its sections. The
    // old file asserted "Ausstehende Updates", a string from a namespace this
    // page does not use — it never had to be right, because it was reached
    // through a login redirect where nothing matched anyway.
    // Since the round-4 inbox (2db14145) the section is a TAB, not a heading:
    // the first CI run on the merged main (2026-09-19, f1e1085c) failed here
    // three times over with "element(s) not found" while the tab was on screen.
    await expect(page.getByRole("tab", { name: /Flug-Updates|Flight updates/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("survives a reload without losing the session", async ({ page }) => {
    await page.reload();
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: /^Posteingang$|^Inbox$/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test.skip(`applies a suggestion and shows the result on the flight — ${NEEDS_A_SUGGESTION}`, async () => {});

  test.skip(`rejects a suggestion and removes it from the list — ${NEEDS_A_SUGGESTION}`, async () => {});

  test.skip(`opens the editor and saves an edited suggestion — ${NEEDS_A_SUGGESTION}`, async () => {});

  test.skip(`shows the statistics impact of a suggestion — ${NEEDS_A_SUGGESTION}`, async () => {});

  test.skip(`shows a count badge in the navigation — ${NEEDS_A_SUGGESTION}`, async () => {});

  test.skip(`shows the before/after diff of a suggestion — ${NEEDS_A_SUGGESTION}`, async () => {});

  test.skip(`sorts the list — ${NEEDS_A_SUGGESTION}`, async () => {});

  test.skip(`filters the list by status — ${NEEDS_A_SUGGESTION}`, async () => {});
});

test.describe("Auto-update settings", () => {
  test("reaches the settings page that governs these suggestions", async ({ page }) => {
    await page.goto("/settings");

    await expect(page).toHaveURL(/\/settings/);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator("h1, h2").first()).toBeVisible({ timeout: 20_000 });
  });
});
