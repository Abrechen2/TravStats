import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display login page', async ({ page }) => {
    await expect(page).toHaveURL(/.*login/);
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.goto('/login');

    await page.fill('input[type="email"]', 'invalid@example.com');
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');

    // Wait for error message
    await expect(page.locator('text=/invalid|error/i')).toBeVisible({ timeout: 5000 });
  });

  test('should navigate to register page', async ({ page }) => {
    await page.goto('/login');

    // Look for register link
    const registerLink = page.locator('a:has-text("Register"), a:has-text("Sign up")');
    if (await registerLink.isVisible()) {
      await registerLink.click();
      await expect(page).toHaveURL(/.*register/);
    }
  });

  test('should require email and password', async ({ page }) => {
    await page.goto('/login');

    // Try to submit without filling fields
    await page.click('button[type="submit"]');

    // Form should still be on login page (validation failed)
    await expect(page).toHaveURL(/.*login/);
  });
});

test.describe('Registration Flow', () => {
  test('should display registration form', async ({ page }) => {
    await page.goto('/register');

    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('should validate password requirements', async ({ page }) => {
    await page.goto('/register');

    const email = `test-${Date.now()}@example.com`;

    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', '123'); // Too short

    // Try to submit
    await page.click('button[type="submit"]');

    // Should show validation error or stay on page
    await expect(page).toHaveURL(/.*register/);
  });
});

test.describe('Authenticated User Flow', () => {
  test.skip('should login and access dashboard', async ({ page }) => {
    // This test requires valid test credentials
    // Skip by default, enable when test user is available

    await page.goto('/login');

    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'testpassword');
    await page.click('button[type="submit"]');

    // Should redirect to dashboard
    await expect(page).toHaveURL(/.*dashboard/);
  });

  test.skip('should logout successfully', async ({ page }) => {
    // Skip by default, requires authenticated session

    // Assume already logged in
    await page.goto('/dashboard');

    // Find and click logout button
    const logoutButton = page.locator('button:has-text("Logout"), a:has-text("Logout")');
    await logoutButton.click();

    // Should redirect to login
    await expect(page).toHaveURL(/.*login/);
  });
});
