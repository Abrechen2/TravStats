import fs from "fs";
import path from "path";

import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";

/**
 * Accessibility ratchet — a scan of the main routes against WCAG 2.x A/AA.
 *
 * 206 findings were fixed on 2026-09-08 and nothing guarded them, so they could
 * come back without a sound. This is the guard, in the shape of the other
 * ratchets (file size, OpenAPI coverage): `a11y.baseline.json` records, per
 * route and axe rule id, how many nodes violate today.
 *
 * - A rule that is not in the baseline for its route, or that violates on MORE
 *   nodes than recorded, FAILS: a new defect.
 * - A recorded rule that no longer violates at all FAILS: a stale entry, delete
 *   it, so the list can only shrink.
 * - A recorded rule with FEWER nodes only prints a request to update. Node
 *   counts follow the seeded data and lazy rendering, and a flaky guard is
 *   worse than a weak one.
 *
 * `A11Y_UPDATE=1 npx playwright test a11y.ratchet --project=chromium` rewrites
 * the baseline from the measurement and refuses to raise any entry or add one;
 * `A11Y_UPDATE=init` may add (first recording only). One engine: axe reads the
 * DOM, which is not an engine question.
 */
const BASELINE_FILE = path.join(__dirname, "a11y.baseline.json");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const UPDATE = process.env.A11Y_UPDATE;

type Baseline = Record<string, Record<string, number>>;

function readBaseline(): Baseline {
  return JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8")) as Baseline;
}

const STATIC_ROUTES = [
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
  "/stats",
  "/stats?tab=flight",
  "/settings/account",
  "/settings/display",
  "/settings/data",
  "/settings/data?section=import",
  "/settings/domains",
  "/settings/notifications",
  "/settings/services",
  "/settings/sharing",
  "/settings/location",
  "/settings/about",
  "/track",
  "/track/explored",
  "/track/months",
  "/track/stays",
  "/track/imports",
];

/** A detail page needs a record id: take the first one the account holds. */
async function firstId(page: Page, endpoint: string): Promise<string | null> {
  const res = await page.request.get(`/api/v1/${endpoint}`);
  if (!res.ok()) return null;
  const body = (await res.json()) as unknown;
  // Bare array, `{data: []}` or a named list such as `{trips: []}`.
  const rows = Array.isArray(body)
    ? body
    : Object.values((body ?? {}) as Record<string, unknown>).find(Array.isArray);
  const first = Array.isArray(rows) ? (rows[0] as { id?: string | number } | undefined) : undefined;
  return first?.id != null ? String(first.id) : null;
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  // Lazy sections only render once scrolled near.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 700) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

async function scan(page: Page): Promise<Record<string, number>> {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const counts: Record<string, number> = {};
  for (const v of result.violations) counts[v.id] = v.nodes.length;
  return counts;
}

const measured: Baseline = {};

test.describe("accessibility ratchet", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "DOM scan, not an engine question");
  test.use({ viewport: { width: 1366, height: 900 } });

  test.afterAll(() => {
    if (!UPDATE || Object.keys(measured).length === 0) return;
    const next = readBaseline();
    for (const [route, rules] of Object.entries(measured)) {
      const old = next[route];
      if (UPDATE !== "init") {
        if (!old) {
          if (Object.keys(rules).length > 0) {
            throw new Error(`${route}: new violations cannot be recorded without A11Y_UPDATE=init`);
          }
          continue;
        }
        for (const [rule, n] of Object.entries(rules)) {
          if (n > (old[rule] ?? 0)) throw new Error(`${route}: ${rule} would be raised to ${n}`);
        }
      }
      if (Object.keys(rules).length === 0) delete next[route];
      else next[route] = rules;
    }
    const sorted = Object.fromEntries(
      Object.keys(next)
        .sort()
        .map((k) => [
          k,
          Object.fromEntries(Object.entries(next[k]).sort(([a], [b]) => a.localeCompare(b))),
        ])
    );
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(sorted, null, 2) + "\n");
  });

  async function check(page: Page, url: string, route = url): Promise<void> {
    await page.goto(url);
    await expect(page).not.toHaveURL(/\/login/);
    await settle(page);
    const found = await scan(page);
    measured[route] = found;
    if (UPDATE) return;

    const allowed = readBaseline()[route] ?? {};
    const fresh = Object.entries(found)
      .filter(([rule, n]) => n > (allowed[rule] ?? 0))
      .map(([rule, n]) => `${rule}: ${n} nodes (baseline ${allowed[rule] ?? 0})`);
    const stale = Object.keys(allowed).filter((rule) => !(rule in found));
    const fewer = Object.entries(found).filter(([rule, n]) => rule in allowed && n < allowed[rule]);
    if (fewer.length > 0) {
      console.log(
        `${route}: fewer nodes than recorded for ${fewer.map(([r]) => r).join(", ")}; run A11Y_UPDATE=1`
      );
    }
    expect(fresh, `${route}: new accessibility violations`).toEqual([]);
    expect(stale, `${route}: fixed rules still in a11y.baseline.json, remove them`).toEqual([]);
  }

  for (const route of STATIC_ROUTES) {
    test(route, async ({ page }) => {
      await check(page, route);
    });
  }

  for (const [label, endpoint, prefix] of [
    ["flight", "flights?limit=1", "/flights/"],
    ["trip", "trips", "/trips/"],
    ["cruise", "cruises", "/cruises/"],
  ] as const) {
    test(`${label} detail page`, async ({ page }) => {
      await page.goto("/dashboard");
      const id = await firstId(page, endpoint);
      test.skip(id === null, `the e2e account holds no ${label}`);
      // Keyed without the id, which differs per database.
      const route = `${prefix}:id`;
      await check(page, `${prefix}${id}`, route);
    });
  }
});
