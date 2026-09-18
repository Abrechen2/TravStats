/**
 * E2E — the authentication ladder, as a user walks it (forgejo#56).
 *
 * Unit tests pin each rung. What they cannot see is the ORDER a browser meets
 * them in, and the order is the security property:
 *
 *  - password, then the second factor, then a due password change. An account
 *    with both flags must be asked for the code BEFORE anything that could set
 *    a new password — otherwise the password alone buys a change token, and
 *    `force-change-password` consumes nothing else: a full account takeover.
 *    (`routes/auth.ts`; CLAUDE.md "Two-factor and passkeys are two DIFFERENT
 *    trades".)
 *  - a passkey is the other trade: it replaces the password AND satisfies the
 *    second factor, so it goes straight in, without ever showing /2fa.
 *
 * Prerequisites, as for the other specs: a dev stack with the seeded admin
 * (admin:admin123). Accounts are created through the admin API and deleted
 * afterwards; the passkey case also restores the instance's WebAuthn settings.
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

import {
  adminApi,
  anonymousApi,
  createAccount,
  deleteAccount,
  enableTwoFactor,
  forcePasswordChange,
  freshTotp,
  type TestAccount,
} from "./support/accounts";

// These are logged-out journeys: they must not start inside the admin session.
test.use({ storageState: { cookies: [], origins: [] } });

async function submitPassword(page: Page, account: TestAccount): Promise<void> {
  await page.goto("/login");
  await page.fill("input#username", account.username);
  await page.fill("input#password", account.password);
  await page.click('button[type="submit"]');
}

async function expectSignedIn(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: /Account menu|Konto-Menü/ })).toBeVisible({
    timeout: 20_000,
  });
}

test.describe("password, then second factor", () => {
  let admin: APIRequestContext;
  let account: TestAccount | undefined;

  test.beforeEach(async ({ baseURL }) => {
    admin = await adminApi(baseURL!);
    account = await enableTwoFactor(baseURL!, await createAccount(admin, "e2e-2fa"));
  });

  test.afterEach(async () => {
    await deleteAccount(admin, account);
    await admin.dispose();
  });

  test("a correct password alone does not sign in", async ({ page }) => {
    await submitPassword(page, account!);
    await expect(page).toHaveURL(/\/2fa$/, { timeout: 15_000 });

    // The proof that the password alone bought nothing: the protected API
    // still answers 401 from this browser.
    const me = await page.request.get("/api/v1/auth/me");
    expect(me.status()).toBe(401);
  });

  test("a wrong code is refused and keeps the user at the prompt", async ({ page }) => {
    await submitPassword(page, account!);
    await expect(page).toHaveURL(/\/2fa$/, { timeout: 15_000 });

    const real = await freshTotp(account!.totpSecret!);
    const wrong = real === "000000" ? "111111" : "000000";
    await page.fill("input#twofa-input", wrong);
    await page.click('button[type="submit"]');

    await expect(
      page.locator("text=/Der Code stimmt nicht|code is not right|incorrect/i").first()
    ).toBeVisible({
      timeout: 10_000,
    });
    await expect(page).toHaveURL(/\/2fa$/);
  });

  test("the right code signs in", async ({ page }) => {
    await submitPassword(page, account!);
    await expect(page).toHaveURL(/\/2fa$/, { timeout: 15_000 });

    await page.fill("input#twofa-input", await freshTotp(account!.totpSecret!));
    await page.click('button[type="submit"]');

    await expectSignedIn(page);
  });
});

test.describe("second factor AND a due password change", () => {
  let admin: APIRequestContext;
  let account: TestAccount | undefined;

  test.beforeEach(async ({ baseURL }) => {
    admin = await adminApi(baseURL!);
    const withTwoFactor = await enableTwoFactor(baseURL!, await createAccount(admin, "e2e-ladder"));
    account = await forcePasswordChange(admin, withTwoFactor);
  });

  test.afterEach(async () => {
    await deleteAccount(admin, account);
    await admin.dispose();
  });

  test("asks for the code FIRST, and the password alone cannot change the password", async ({
    page,
  }) => {
    await submitPassword(page, account!);

    // The ordering itself: the code prompt, not the change form.
    await expect(page).toHaveURL(/\/2fa$/, { timeout: 15_000 });

    // And the server agrees. From this exact browser state — password proven,
    // code not — the forced change must be refused. If the login had issued a
    // change token, this request would set a password the attacker chose.
    const takeover = await page.request.post("/api/v1/auth/force-change-password", {
      data: { newPassword: "attacker-chosen-1" },
    });
    expect(takeover.ok()).toBe(false);

    // The deep link does not help either: without the flow's state the page
    // sends the visitor back to the login.
    await page.goto("/change-password");
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test("walks the whole ladder: password, code, new password, sign in with it", async ({
    page,
    baseURL,
  }) => {
    await submitPassword(page, account!);
    await expect(page).toHaveURL(/\/2fa$/, { timeout: 15_000 });

    await page.fill("input#twofa-input", await freshTotp(account!.totpSecret!));
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/change-password$/, { timeout: 15_000 });
    const newPassword = `${account!.password}-new`;
    await page.fill("input#newPassword", newPassword);
    await page.fill("input#confirmPassword", newPassword);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

    // The OLD password is dead…
    const probe = await anonymousApi(baseURL!);
    try {
      const old = await probe.post("/api/v1/auth/login", {
        data: { username: account!.username, password: account!.password },
      });
      expect(old.status()).toBe(401);
    } finally {
      await probe.dispose();
    }

    // …and the new one still has to pass the second factor, not the change.
    await submitPassword(page, { ...account!, password: newPassword });
    await expect(page).toHaveURL(/\/2fa$/, { timeout: 15_000 });
    await page.fill("input#twofa-input", await freshTotp(account!.totpSecret!));
    await page.click('button[type="submit"]');
    await expectSignedIn(page);
  });
});

test.describe("passkey", () => {
  // The virtual authenticator is a Chrome DevTools Protocol feature. Firefox
  // and WebKit have no equivalent Playwright can drive, so the case is
  // Chromium-only by necessity, not by preference.
  test.skip(({ browserName }) => browserName !== "chromium", "virtual authenticator needs CDP");

  let admin: APIRequestContext;
  let account: TestAccount | undefined;
  let previous: { webauthnRpId: string | null; webauthnOrigins: string[] } | undefined;

  test.beforeEach(async ({ baseURL }) => {
    admin = await adminApi(baseURL!);
    const current = await admin.get("/api/v1/admin/instance-settings");
    expect(current.ok()).toBe(true);
    const { settings } = (await current.json()) as {
      settings: { webauthnRpId: string | null; webauthnOrigins: string[] };
    };
    previous = { webauthnRpId: settings.webauthnRpId, webauthnOrigins: settings.webauthnOrigins };

    const origin = new URL(baseURL!).origin;
    const put = await admin.put("/api/v1/admin/instance-settings", {
      data: { webauthnRpId: new URL(origin).hostname, webauthnOrigins: [origin] },
    });
    expect(put.ok(), await put.text()).toBe(true);

    account = await enableTwoFactor(baseURL!, await createAccount(admin, "e2e-passkey"));
  });

  test.afterEach(async () => {
    await deleteAccount(admin, account);
    if (previous) {
      await admin.put("/api/v1/admin/instance-settings", {
        data: {
          webauthnRpId: previous.webauthnRpId ?? "",
          webauthnOrigins: previous.webauthnOrigins,
        },
      });
    }
    await admin.dispose();
  });

  test("a passkey signs in without the password and without the code", async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        // The server demands userVerification "required"; an authenticator
        // that could not verify would be refused, which is the point.
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    // Register the passkey the way a user does: signed in (password + code),
    // in the security settings.
    await submitPassword(page, account!);
    await expect(page).toHaveURL(/\/2fa$/, { timeout: 15_000 });
    await page.fill("input#twofa-input", await freshTotp(account!.totpSecret!));
    await page.click('button[type="submit"]');
    await expectSignedIn(page);

    await page.goto("/settings?section=security");
    await page.getByRole("button", { name: /Passkey hinzufügen|Add passkey/i }).click();
    await page.fill("input#passkey-name", "E2E virtual authenticator");
    await page.getByRole("button", { name: /^Anlegen$|^Create$|^Add$/i }).click();
    await expect(page.getByText("E2E virtual authenticator")).toBeVisible({ timeout: 15_000 });

    // Leave, with nothing but the authenticator.
    await page.request.post("/api/v1/auth/logout");
    await page.context().clearCookies();

    await page.goto("/login");
    await page
      .getByRole("button", { name: /Mit Passkey anmelden|Sign in with a passkey|passkey/i })
      .click();

    await expectSignedIn(page);
    // Never shown the code prompt: the passkey satisfied both factors.
    await expect(page).not.toHaveURL(/\/2fa/);
  });
});
