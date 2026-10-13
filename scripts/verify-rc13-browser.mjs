/** Isolated Chromium regressions: real components and keyboard events, synthetic API responses. */
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../frontend/node_modules/vite/dist/node/index.js";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontend = path.join(root, "frontend");
const fixtureDir = await mkdtemp(path.join(tmpdir(), "travstats-rc13-"));
const entry = path.join(fixtureDir, "main.tsx");
const from = (relative) => JSON.stringify(path.join(frontend, "src", relative));
await writeFile(
  entry,
  `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import ${from("i18n/config.ts")};
import ${from("index.css")};
import { BusFormModal } from ${from("components/bus/BusFormModal.tsx")};
import { rideFixture } from ${from("components/bus/__tests__/busFixture.ts")};
import { GenericCsvImportTile } from ${from("components/import/GenericCsvImportTile.tsx")};
import ReviewParserNotices from ${from("components/FlightForm/ReviewParserNotices.tsx")};
function App() {
 const [ride, setRide] = useState({...rideFixture(), price: 10, currency: 'EUR'});
 const [open, setOpen] = useState(true);
 const mode = new URLSearchParams(location.search).get('mode');
 if (mode === 'csv') return <GenericCsvImportTile />;
 if (mode === 'notice') return <ReviewParserNotices data={{ missing: [], airlineNotice: 'flight_cancellation', inferredFields: ['departureTime'] }} />;
 return <><button onClick={() => setOpen(true)}>Reopen</button>
 <output data-testid="saved-price">{JSON.stringify(ride.price)}</output>
 {open && <BusFormModal journey={ride} onClose={() => setOpen(false)} onSaved={(saved) => {setRide(saved);setOpen(false);}} />}</>;
}
createRoot(document.getElementById('root')!).render(<MemoryRouter><App /></MemoryRouter>);
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
          if (!req.url?.startsWith("/__rc13")) return next();
          res.setHeader("Content-Type", "text/html");
          res.end(
            await vite.transformIndexHtml(
              "/__rc13",
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
    let sent;
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (!url.pathname.startsWith("/api/")) return route.continue();
      let body = [];
      if (url.pathname.endsWith("/trips")) body = { trips: [] };
      if (url.pathname.endsWith("/bus/r1") && route.request().method() === "PATCH") {
        sent = route.request().postDataJSON();
        body = {
          success: true,
          data: {
            id: "r1",
            ...sent,
            price: sent.price,
            currency: "EUR",
            depStationName: "Seoul",
            depLat: 37.5,
            depLon: 127,
            arrStationName: "Sokcho",
            arrLat: 38.2,
            arrLon: 128.6,
            depTimezone: "Asia/Seoul",
            arrTimezone: "Asia/Seoul",
            departureTime: "2026-09-20T00:00:00Z",
            arrivalTime: null,
            distanceSource: "user",
            distanceKm: null,
            delayMinutes: null,
            tags: [],
            companions: [],
          },
        };
      } else if (url.pathname.endsWith("/bus/entry-suggestions"))
        body = { data: { operators: [], fareClasses: [], terminals: [] } };
      else if (url.pathname.endsWith("/bus/routing")) body = { data: { configured: false } };
      else if (url.pathname.endsWith("/import/preview"))
        body = { rows: [], summary: { ok: 1, problems: 0, duplicates: 0, unresolvable: 0 } };
      await route.fulfill({ json: body });
    });
    for (const [raw, expected] of [
      ["39,90", 39.9],
      ["39.90", 39.9],
      ["0", 0],
      ["", null],
    ]) {
      await page.goto(`${base}/__rc13`);
      const price = page.locator("#bus-price");
      await price.waitFor();
      await price.fill("");
      await price.pressSequentially(raw);
      assert((await price.inputValue()) === raw, `keyboard changed ${raw} (${locale})`);
      const request = page.waitForRequest(
        (r) => r.url().endsWith("/bus/r1") && r.method() === "PATCH"
      );
      await page.getByTestId("bus-form-save").click();
      await request;
      await page.getByTestId("saved-price").waitFor({ state: "visible" });
      await page.waitForFunction(
        (expected) =>
          document.querySelector('[data-testid="saved-price"]')?.textContent ===
          JSON.stringify(expected),
        expected
      );
      assert(sent.price === expected, `wrong API price for ${raw} (${locale})`);
      await page.getByText("Reopen", { exact: true }).click();
      assert(
        (await page.locator("#bus-price").inputValue()) ===
          (expected === null ? "" : String(expected)),
        "reopened price differs"
      );
    }
    await page.goto(`${base}/__rc13`);
    await page.locator("#bus-price").fill("wrong");
    sent = undefined;
    await page.getByTestId("bus-form-save").click();
    await page.locator('#bus-price[aria-invalid="true"]').waitFor();
    assert(sent === undefined, "invalid price was sent");
    for (const width of [1280, 360]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${base}/__rc13?mode=csv`);
      await page.locator('input[type="file"]').setInputFiles({
        name: "flights.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          "date,from,to,depTimeLocal,arrTimeLocal,flight\n2025-07-10,MUC,CDG,10:00,12:00:00,QA1020"
        ),
      });
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: /Weiter|Continue/ }).click();
      const error = dialog.getByTestId("wizard-submit-error");
      await error.waitFor();
      const box = await error.boundingBox();
      assert(
        box && box.y >= 0 && box.y + box.height <= 800 && box.x + box.width <= width,
        `CSV error offscreen at ${width}`
      );
      assert(
        await dialog.getByRole("button", { name: /Weiter|Continue/ }).isDisabled(),
        "repeated CSV rejection enabled"
      );
    }
    await page.goto(`${base}/__rc13?mode=notice`);
    await page.getByRole("alert").waitFor();
    assert(
      /Stornierung|cancellation/.test(await page.getByRole("alert").innerText()),
      "cancellation warning missing"
    );
    assert(
      (await page.getByRole("alert").innerText()).includes("00:00"),
      "unknown clock warning missing"
    );
    assert(errors.length === 0, `browser errors: ${errors.join(", ")}`);
    console.log(
      `${locale}: keyboard prices, reopen, invalid price, CSV desktop/mobile and cancellation notices passed`
    );
    await context.close();
  }
} finally {
  await browser?.close();
  await server.close();
  await rm(fixtureDir, { recursive: true, force: true });
}
