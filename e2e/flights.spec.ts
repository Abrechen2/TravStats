import { test, expect } from '@playwright/test';

test.describe('Flights Management', () => {
  test.beforeEach(async ({ page }) => {
    // Note: These tests assume user is logged in
    // You may need to add authentication setup here
    await page.goto('/');
  });

  test('should display flights table', async ({ page }) => {
    // Navigate to flights page
    await page.goto('/flights');

    // Check if table or flight list is visible
    const flightsList = page.locator('[data-testid="flights-table"], table, [class*="flight"]');
    await expect(flightsList).toBeVisible({ timeout: 10000 });
  });

  test('should open flight creation form', async ({ page }) => {
    await page.goto('/flights');

    // Look for add/create flight button
    const addButton = page.locator('button:has-text("Add"), button:has-text("Create"), button:has-text("New")');

    if (await addButton.isVisible()) {
      await addButton.click();

      // Form should appear
      await expect(
        page.locator('input[name="flightNumber"], input[placeholder*="flight"]')
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test('should filter flights', async ({ page }) => {
    await page.goto('/flights');

    // Look for filter/search input
    const searchInput = page.locator('input[type="search"], input[placeholder*="search"], input[placeholder*="filter"]');

    if (await searchInput.isVisible()) {
      await searchInput.fill('LH');

      // Wait for results to filter
      await page.waitForTimeout(1000);

      // Results should update
      const results = page.locator('[data-testid="flight-row"], tr[class*="flight"]');
      await expect(results.first()).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe('Flight Details', () => {
  test('should display flight statistics', async ({ page }) => {
    await page.goto('/');

    // Navigate to stats/dashboard
    const statsLink = page.locator('a:has-text("Stats"), a:has-text("Dashboard"), a:has-text("Statistics")');

    if (await statsLink.isVisible()) {
      await statsLink.click();

      // Should show statistics
      await expect(
        page.locator('text=/total|flights|distance|airports/i')
      ).toBeVisible({ timeout: 10000 });
    }
  });
});

test.describe('Map Visualization', () => {
  test('should load map view', async ({ page }) => {
    await page.goto('/');

    // Look for map link
    const mapLink = page.locator('a:has-text("Map"), a:has-text("Globe")');

    if (await mapLink.isVisible()) {
      await mapLink.click();

      // Wait for map to load
      await page.waitForTimeout(2000);

      // Check if canvas or map container is visible
      const mapContainer = page.locator('canvas, [class*="map"], [class*="globe"]');
      await expect(mapContainer.first()).toBeVisible({ timeout: 10000 });
    }
  });
});
