import { test, expect } from "@playwright/test";

/**
 * No main route widens the document at 320 px.
 *
 * Three phone-width defects shipped in 2.7.0-beta.20 with green suites because
 * no test ever looked at a layout: a statistics table with no scroll region of
 * its own (forgejo#290), a stat card whose longest word was wider than its grid
 * cell (forgejo#291) and a fieldset whose UA default `min-inline-size` kept it
 * from shrinking (forgejo#292). Each of them showed up as the same symptom —
 * `documentElement.scrollWidth > innerWidth` — which is what this asserts.
 *
 * Covers the id-less routes of the signed-in app: dashboard, every list page,
 * the statistics overview and every domain tab, every settings group and the
 * three admin tabs. It cannot reach detail pages (they need a record id) and it
 * looks at whatever data the e2e account holds, so an empty account passes
 * routes a full one would fail; the full sweep over every domain's data is done
 * by hand with `scrollWidth` plus the offending element. One browser only —
 * layout width is not an engine question — and one width, to stay light.
 */
const ROUTES = [
  "/dashboard",
  "/flights",
  "/cruises",
  "/rail",
  "/rentals",
  "/bus",
  "/lodging",
  "/places",
  "/trips",
  "/tours",
  "/roadtrips",
  "/notes",
  "/achievements",
  "/loyalty",
  "/stats",
  "/stats?tab=flight",
  "/stats?tab=cruise",
  "/stats?tab=lodging",
  "/stats?tab=poi",
  "/settings/account",
  "/settings/display",
  "/settings/data",
  "/admin",
  "/admin?section=backups",
  "/admin?tab=cruise",
];

test.describe("no horizontal overflow at 320 px", () => {
  test.use({ viewport: { width: 320, height: 800 } });
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "layout width, not an engine question"
  );

  for (const route of ROUTES) {
    test(route, async ({ page }) => {
      await page.goto(route);
      await expect(page).not.toHaveURL(/\/login/);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      // Lazy sections (admin, statistics) only render once scrolled near.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 700) {
          window.scrollTo(0, y);
          await new Promise((resolve) => setTimeout(resolve, 80));
        }
        window.scrollTo(0, 0);
      });
      const widths = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        inner: window.innerWidth,
      }));
      expect(
        widths.scroll,
        `${route}: document is ${widths.scroll}px in a ${widths.inner}px window`
      ).toBeLessThanOrEqual(widths.inner);
    });
  }
});
