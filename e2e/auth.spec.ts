/**
 * E2E — authentication critical path
 *
 * Rewritten 2026-08-09: the original file was generic scaffolding that never
 * matched this app — it asserted `input[type="email"]` although the login has
 * always been username-based (import.fr24.spec.ts documents the real
 * selectors). Every assertion here is against the actual components:
 *
 *  - LoginPage: input#username (type text) + input#password, button[type=submit]
 *  - RegisterPage: #reg-username / #reg-password / #reg-confirm
 *  - Logout lives in the account menu (UserMenu, since #241) — not the top bar
 *
 * Prerequisites, same as the import specs:
 *  - dev server running (PLAYWRIGHT_BASE_URL or localhost:3000)
 *  - dev DB seeded with admin:admin123 via `npm run seed:dev-admin`
 *
 * The config runs with locale de-DE, so user-facing copy asserts the German
 * strings (with the EN alternative for anyone running against an EN session).
 */
import { test, expect } from "@playwright/test";

// These are the LOGGED-OUT paths, so they must not inherit the signed-in
// session the setup project writes for everything else (AUD-098).
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Authentication Flow", () => {
  test("shows the username/password form on the login page", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("input#username")).toBeVisible();
    await expect(page.locator("input#password")).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test("redirects an anonymous visitor to the login page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/.*login/);
  });

  test("rejects wrong credentials with a visible message", async ({ page }) => {
    await page.goto("/login");
    await page.fill("input#username", "nobody");
    await page.fill("input#password", "wrongpassword");
    await page.click('button[type="submit"]');

    await expect(
      page.locator("text=/fehlgeschlagen|ungültig|failed|invalid/i").first()
    ).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/.*login/);
  });

  test("does not advertise registration while it is closed", async ({ page }) => {
    // `LoginPage` renders the link only when `registrationEnabled !== false`,
    // and the seeded dev instance has an admin, which closes registration. The
    // old version clicked a link that is not there and failed on every run.
    //
    // Asserting its ABSENCE is the deterministic half, and the one worth
    // having: an instance that is closed must not invite people to sign up.
    await page.goto("/login");
    await expect(page.locator('a[href="/register"]')).toHaveCount(0);
  });

  test("serves the registration route by URL regardless", async ({ page }) => {
    // The route exists whether or not the login page advertises it; what it
    // then shows is the instance's decision, and either way it must not be a
    // blank page.
    await page.goto("/register");
    await expect(page.locator("h1, h2, form").first()).toBeVisible({ timeout: 15_000 });
  });

  test("native validation keeps an empty submit on the login page", async ({ page }) => {
    await page.goto("/login");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*login/);
  });
});

test.describe("Registration Flow", () => {
  test("shows the username form, or says plainly that registration is closed", async ({
    page,
  }) => {
    await page.goto("/register");

    // Instance-dependent by design: allowRegistration defaults to false, so a
    // fresh install (and every preview slot) shows a notice instead of the
    // form. Both are correct — what would be wrong is an email field, which
    // this app never had, or a silent blank page.
    const usernameField = page.locator("input#reg-username");
    const closedNotice = page.locator(
      "text=/Registrierung.*(deaktiviert|geschlossen)|registration.*(disabled|closed)|Einladung|invitation/i"
    );
    await expect(usernameField.or(closedNotice).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('input[type="email"]')).toHaveCount(0);
  });
});

test.describe("Authenticated User Flow", () => {
  test("logs in with the seeded admin and reaches the dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.fill("input#username", "admin");
    await page.fill("input#password", "admin123");
    await page.click('button[type="submit"]');

    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
    // The nav only renders for a live session.
    await expect(page.getByRole("button", { name: /Account menu|Konto-Menü/ })).toBeVisible({
      timeout: 15000,
    });
  });

  test("logs out through the account menu", async ({ page }) => {
    await page.goto("/login");
    await page.fill("input#username", "admin");
    await page.fill("input#password", "admin123");
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });

    // Away from the dashboard, and then WAIT for the page to settle. The
    // account-menu button is found immediately but keeps failing Playwright's
    // "stable" check while the header reflows around loading data, so the
    // click times out on an element it has already located — a failure about
    // page settling, not about logging out.
    await page.goto("/flights");
    await expect(page.getByRole("heading", { name: /^Flüge$|^Flights$/i })).toBeVisible({
      timeout: 20_000,
    });
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /Account menu|Konto-Menü/ }).click();
    await page.locator("text=/Abmelden|Logout/i").first().click();

    await expect(page).toHaveURL(/.*login/, { timeout: 10000 });
  });
});
