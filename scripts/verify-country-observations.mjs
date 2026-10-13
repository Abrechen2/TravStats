/** Isolated Chromium check for forgejo#299: real UI and translations, synthetic locations. */
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../frontend/node_modules/vite/dist/node/index.js";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontend = path.join(root, "frontend");
const fixtureDir = await mkdtemp(path.join(tmpdir(), "travstats-country-observations-"));
const entry = path.join(fixtureDir, "main.tsx");
const from = (relative) => JSON.stringify(path.join(frontend, "src", relative));
await writeFile(
  entry,
  `
import React from 'react';
import { createRoot } from 'react-dom/client';
import ${from("i18n/config.ts")};
import ${from("index.css")};
import { useSettingsStore } from ${from("store/settingsStore.ts")};
import UnconfirmedCountries from ${from("components/Passport/UnconfirmedCountries.tsx")};
const language = new URLSearchParams(location.search).get('language') ?? 'de';
useSettingsStore.setState((s) => ({display: {...s.display, language}}));
const countries = [
 {code:'SY', source:'dawarich', reason:'ground-unconfirmed', observedDays:1, pointCount:1, firstDate:'2024-06-01', lastDate:'2024-06-01'},
 {code:'DE', source:'dawarich', reason:'ground-unconfirmed', observedDays:2, pointCount:500, firstDate:'2024-01-02', lastDate:'2024-01-03'},
];
createRoot(document.getElementById('root')!).render(<main style={{padding:16}}><UnconfirmedCountries countries={countries} locale={language} /></main>);

`
);
const server = await createServer({
  root: frontend,
  logLevel: "error",
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      react: path.join(frontend, "node_modules/react"),
      "react-dom": path.join(frontend, "node_modules/react-dom"),
      "react-router-dom": path.join(frontend, "node_modules/react-router-dom"),
    },
  },
  server: { host: "127.0.0.1", port: 0, fs: { allow: [frontend, fixtureDir] } },
  plugins: [
    {
      name: "regression-page",
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith("/__observations")) return next();
          res.setHeader("Content-Type", "text/html");
          res.end(
            await vite.transformIndexHtml(
              "/__observations",
              `<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/@fs${entry}"></script></body></html>`
            )
          );
        });
      },
    },
  ],
});
let browser;
function assert(value, message) {
  if (!value) throw new Error(message);
}
try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
  for (const locale of ["de-DE", "en-US"]) {
    const context = await browser.newContext({ locale, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.error(error.stack);
    });
    page.on("console", (message) => {
      if (message.type() === "error") console.error(message.text());
    });
    await page.route("**/api/**", (route) =>
      new URL(route.request().url()).pathname.startsWith("/api/")
        ? route.fulfill({ json: {} })
        : route.continue()
    );
    for (const width of [1280, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/__observations?language=${locale.slice(0, 2)}`);
      const title = locale === "de-DE" ? "Unbestätigte Standorttage" : "Unconfirmed location days";
      const section = page.getByRole("region", { name: title });
      await section.waitFor({ state: "visible" });
      assert(
        await section
          .getByText(locale === "de-DE" ? "Syrien" : "Syria", { exact: true })
          .isVisible(),
        "country missing"
      );
      assert((await section.locator("time").count()) === 3, "observation dates missing");
      assert((await section.innerText()).includes("500"), "point count missing");
      assert(!(await section.innerText()).includes("{{"), "unresolved translations");
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        "horizontal overflow"
      );
      if (width === 360) await page.screenshot({ path: `/tmp/country-observations-${locale}.png` });
    }
    assert(errors.length === 0, `browser errors: ${errors.join("; ")}`);
    await context.close();
  }
  console.log(
    "Chromium: location observations shown separately, translated in DE/EN, dates and points visible at desktop and 360px."
  );
} finally {
  await browser?.close();
  await server.close();
  await rm(fixtureDir, { recursive: true, force: true });
}
