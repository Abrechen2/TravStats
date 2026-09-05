/**
 * Takes the block screenshots for the design-system work.
 *
 * Usage: node scripts/design-screenshots.mjs <block> <name=path> [<name=path> …]
 *   node scripts/design-screenshots.mjs block-1 settings-account=/settings/account
 *
 * Writes `<name>-1440x900.png` and `<name>-390x844.png` into
 * `ClaudeDesign/screenshots/design-system/<block>/`. Expects a running stack —
 * frontend on FE (default http://localhost:3001), backend on BE — and logs in
 * with the seeded dev admin before the first shot.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FE = process.env.FE ?? "http://localhost:3001";
const USER = process.env.UAT_USER ?? "admin";
const PASS = process.env.UAT_PASS ?? "admin123";

const [block, ...pairs] = process.argv.slice(2);
if (!block || pairs.length === 0) {
  console.error("usage: design-screenshots.mjs <block> <name=path> [...]");
  process.exit(1);
}

const outDir = resolve(
  here,
  "../ClaudeDesign/screenshots/design-system",
  block,
);
mkdirSync(outDir, { recursive: true });

const VIEWPORTS = [
  { label: "1440x900", width: 1440, height: 900 },
  { label: "390x844", width: 390, height: 844 },
];

const browser = await chromium.launch();

/**
 * First login on a fresh instance stacks three modals, each swallowing pointer
 * events: the airport-seeding notice, "New in TravStats" and the usage-stats
 * consent card. Dismissing them is part of getting a clean shot, not of the
 * thing being shot.
 */
async function dismissOverlays(page) {
  for (let i = 0; i < 6; i++) {
    const button = page
      .getByRole("button", {
        name: /got it|verstanden|no, thanks|nein, danke|schließen|close/i,
      })
      .first();
    if ((await button.count()) === 0) break;
    await button.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(250);
  }
}

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    locale: "de-DE",
  });
  const page = await context.newPage();

  await page.goto(`${FE}/login`, { waitUntil: "networkidle" });
  await page
    .getByLabel(/benutzername|username/i)
    .first()
    .fill(USER);
  await page
    .getByLabel(/passwort|password/i)
    .first()
    .fill(PASS);
  await page
    .getByRole("button", { name: /anmelden|sign in|log in/i })
    .first()
    .click();
  await page.waitForURL(/\/(dashboard|settings)/, { timeout: 20000 });
  await dismissOverlays(page);

  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq);
    const path = pair.slice(eq + 1);
    await page.goto(`${FE}${path}`, { waitUntil: "networkidle" });
    await dismissOverlays(page);
    // Fonts settle after the swap; a shot taken during it shows the fallback.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600);
    const file = resolve(outDir, `${name}-${viewport.label}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`wrote ${file}`);
  }

  await context.close();
}

await browser.close();
