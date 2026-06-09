// Visual smoke test for the brand-cleanup work. Walks the dev app, logs
// in as admin, captures screenshots of every surface that got touched
// across rounds 1-3, plus the original "where is the Sonder-Flug card"
// path. Output: ./brand-smoke-shots/*.png next to the script.
//
// Run with: node scripts/brand-smoke.mjs
// Requires the dev server on http://localhost:3003 + an admin/admin123
// account (the project's standard local seed).

import { chromium } from "playwright";
import { mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE = "http://localhost:3003";
const OUT = path.resolve(__dirname, "..", "brand-smoke-shots");
mkdirSync(OUT, { recursive: true });

const shot = async (page, name) => {
  await page.waitForTimeout(500); // let any HMR / lazy chunk settle
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  console.log("  →", `${name}.png`);
};

const safeClick = async (page, selector, opts = {}) => {
  try {
    await page.locator(selector).first().click({ timeout: 3000, ...opts });
    return true;
  } catch {
    return false;
  }
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.warn("[pageerror]", e.message));

  console.log("Login");
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="username"], input[type="text"]', "admin");
  await page.fill('input[type="password"]', "admin123");
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 10000 });

  console.log("Dashboard /dashboard/all (Aktivität pill, legend chips)");
  await page.goto(`${BASE}/dashboard/all?mode=routes`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  await shot(page, "01-dashboard-all-routes");

  console.log("Dashboard /dashboard/flights — open Aktivität sidebar");
  await page.goto(`${BASE}/dashboard/flights?mode=routes`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  await shot(page, "02-flights-tab-collapsed");
  await safeClick(page, 'button:has-text("Flüge")');
  await page.waitForTimeout(400);
  await shot(page, "03-flights-tab-sidebar-open");

  console.log("Add Flight form (Email amber + Sonder-Flug amber)");
  await safeClick(page, 'button:has-text("Flug hinzufügen")');
  await page.waitForTimeout(600);
  await shot(page, "04-add-flight-form-top");
  // Scroll inside the modal to reveal the Sonder-Flug card
  await page.evaluate(() => {
    const modal = document.querySelector(".max-h-\\[90vh\\]");
    if (modal) modal.scrollTop = modal.scrollHeight;
  });
  await page.waitForTimeout(300);
  await shot(page, "05-add-flight-form-special-card");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  console.log("/flights page — top-level add button + table");
  await page.goto(`${BASE}/flights`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  await shot(page, "06-flights-page-top");

  console.log("Stats page (progress bars + seat zones — amber gradient)");
  await page.goto(`${BASE}/stats`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  await shot(page, "07-stats-overview-top");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  await shot(page, "08-stats-overview-bottom");

  console.log("Cruise edit chooser — open via /cruises page (new amber email hero)");
  await page.goto(`${BASE}/cruises`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  await safeClick(page, 'button:has-text("Hinzufügen"), button:has-text("Add"), button:has-text("Neu")');
  await page.waitForTimeout(700);
  await shot(page, "09-cruise-chooser");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  console.log("Admin / Logging Manager (debug + save buttons → amber)");
  await page.goto(`${BASE}/admin`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  await shot(page, "10-admin-overview");
  // Click Logging tab if visible
  await safeClick(page, 'button:has-text("Logging"), a:has-text("Logging")');
  await page.waitForTimeout(500);
  await shot(page, "11-admin-logging");

  console.log("Trips page (newly added NavigationBar header)");
  await page.goto(`${BASE}/trips`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  await shot(page, "12-trips-page");

  await browser.close();
  console.log("\nDone — screenshots in", OUT);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
