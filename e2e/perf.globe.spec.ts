import { test, expect, type Page } from "@playwright/test";

/**
 * Frame-time measurement of the dashboard globe and the flat map (forgejo#332
 * item 3). A MEASUREMENT, not a gate: it is skipped unless `PERF_FRAMES=1`, and
 * it asserts only that frames were recorded. Results are attached to the test
 * report as JSON and printed, so a run can be pasted into the issue.
 *
 *   PERF_FRAMES=1 PLAYWRIGHT_BASE_URL=http://localhost:3011 \
 *     npx playwright test e2e/perf.globe.spec.ts --project=chromium
 *
 * Headless Chromium renders WebGL in software (SwiftShader), which is the
 * "desktop with software rendering" case of the issue. It is NOT an iPad GPU:
 * read the numbers as an upper bound on per-frame work, not as device speed.
 */
const SAMPLE_MS = 6_000;
const VIEWPORTS = [
  { name: "ipad-1366x1024", width: 1366, height: 1024 },
  { name: "ipad-820x1180", width: 820, height: 1180 },
] as const;
const MODES = ["globe", "overview"] as const;

interface FrameStats {
  frames: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  over50msPercent: number;
}

function summarise(deltas: number[]): FrameStats {
  const sorted = [...deltas].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    frames: deltas.length,
    meanMs: round(deltas.reduce((a, b) => a + b, 0) / Math.max(1, deltas.length)),
    p50Ms: round(at(0.5)),
    p95Ms: round(at(0.95)),
    maxMs: round(sorted[sorted.length - 1] ?? 0),
    over50msPercent: round(
      (100 * deltas.filter((d) => d > 50).length) / Math.max(1, deltas.length)
    ),
  };
}

async function recordFrames(page: Page): Promise<number[]> {
  return page.evaluate(
    (ms) =>
      new Promise<number[]>((resolve) => {
        const deltas: number[] = [];
        let last = performance.now();
        const start = last;
        const tick = (now: number) => {
          deltas.push(now - last);
          last = now;
          if (now - start < ms) requestAnimationFrame(tick);
          else resolve(deltas);
        };
        requestAnimationFrame(tick);
      }),
    SAMPLE_MS
  );
}

test.describe("map frame times (measurement)", () => {
  test.skip(!process.env.PERF_FRAMES, "set PERF_FRAMES=1 to measure");

  for (const viewport of VIEWPORTS) {
    for (const mode of MODES) {
      test(`${mode} at ${viewport.name}`, async ({ page }, testInfo) => {
        test.setTimeout(60_000);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const violations: string[] = [];
        // The page is served without nginx here, so give the document the
        // production script policy (no 'unsafe-eval'): a code path that probes
        // eval shows up as a violation instead of passing unobserved.
        await page.route("**/dashboard*", async (route) => {
          if (route.request().resourceType() !== "document") return route.continue();
          const response = await route.fetch();
          await route.fulfill({
            response,
            headers: { ...response.headers(), "content-security-policy": "script-src 'self'" },
          });
        });
        await page.addInitScript(() => {
          document.addEventListener("securitypolicyviolation", (e) =>
            (window as unknown as { __csp: string[] }).__csp.push(
              `${e.violatedDirective} ${e.blockedURI}`
            )
          );
          (window as unknown as { __csp: string[] }).__csp = [];
        });
        await page.goto(`/dashboard?mode=${mode}`);
        await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
        // Let tiles and layers settle, then pan a little so the sample is not an idle map.
        await page.waitForTimeout(3_000);
        const box = await page.locator("canvas").first().boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 40, {
            steps: 30,
          });
          await page.mouse.up();
        }
        const idle = summarise(await recordFrames(page));
        violations.push(
          ...(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp))
        );
        const result = { mode, viewport: viewport.name, idle, cspViolations: violations };
        await testInfo.attach("frame-times.json", {
          body: JSON.stringify(result, null, 2),
          contentType: "application/json",
        });
        console.log(`PERF ${JSON.stringify(result)}`);
        expect(idle.frames).toBeGreaterThan(0);
      });
    }
  }
});
