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
 *  - dev server running (PLAYWRIGHT_BASE_URL or localhost:5173)
 *  - dev DB seeded with admin:admin123 via `npm run seed:dev-admin`
 *
 * The config runs with locale de-DE, so user-facing copy asserts the German
 * strings (with the EN alternative for anyone running against an EN session).
 */
import { test, expect } from "@playwright/test";

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

  test("links to the registration page", async ({ page }) => {
    await page.goto("/login");
    // href-based, so the assertion holds in either locale.
    await page.locator('a[href="/register"]').click();
    await expect(page).toHaveURL(/.*register/);
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

    await page.getByRole("button", { name: /Account menu|Konto-Menü/ }).click();
    await page.locator("text=/Abmelden|Logout/i").first().click();

    await expect(page).toHaveURL(/.*login/, { timeout: 10000 });
  });
});
