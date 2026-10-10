/**
 * forgejo#88 acceptance, 2026-10-10: Settings → Konto draws the bulk-refresh
 * card, and the card asks `GET /flights/refresh-historical-bulk/preview` on
 * every visit. That read sat behind `flightCreationLimiter` — the SAME
 * limiter instance, and so the same per-user bucket, as `POST /flights`.
 * Twenty visits to the settings page in an hour (ten under React's dev
 * double-render) answered the preview with 429 and left the account unable
 * to add a single flight until the hour ran out.
 *
 * The router stack is read rather than a server driven: what matters is
 * which limiter instance each route carries, and twenty real requests would
 * measure the limiter's arithmetic, not the wiring.
 */
import type { Router } from "express";
import { flightCreationLimiter, statsLimiter } from "../../middleware/rateLimit";
import router from "../flights";

interface Layer {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] };
}

function handlesOf(path: string, method: "get" | "post"): unknown[] {
  const layer = (router as unknown as Router & { stack: Layer[] }).stack.find(
    (l) => l.route?.path === path && l.route.methods[method]
  );
  if (!layer?.route) throw new Error(`no ${method.toUpperCase()} ${path} on the flights router`);
  return layer.route.stack.map((s) => s.handle);
}

describe("flights router — the bulk-refresh preview does not spend flight creations", () => {
  it("creating a flight is still limited by flightCreationLimiter", () => {
    expect(handlesOf("/", "post")).toContain(flightCreationLimiter);
  });

  it("the preview read is not, and is limited as a read instead", () => {
    const handles = handlesOf("/refresh-historical-bulk/preview", "get");
    expect(handles).not.toContain(flightCreationLimiter);
    expect(handles).toContain(statsLimiter);
  });
});
