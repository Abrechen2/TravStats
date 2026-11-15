// forgejo#332 item 4: the `script-src eval` violation in the console came from
// zod probing for `new Function`, not from deck.gl or luma.gl. Behind a CSP
// without 'unsafe-eval' that probe is reported on every page load.

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function parseAndCountFunctionConstructions(withConfig: boolean): Promise<number> {
  vi.resetModules();
  const RealFunction = Function;
  let constructed = 0;
  vi.stubGlobal(
    "Function",
    new Proxy(RealFunction, {
      construct(target, args) {
        constructed += 1;
        return Reflect.construct(target, args);
      },
    })
  );
  if (withConfig) await import("../zodConfig");
  const { z } = await import("zod");
  z.object({ a: z.string(), b: z.number().optional() }).parse({ a: "x" });
  return constructed;
}

describe("zod and the Content-Security-Policy", () => {
  it("probes for eval by default, which a CSP without 'unsafe-eval' reports (positive control)", async () => {
    expect(await parseAndCountFunctionConstructions(false)).toBeGreaterThan(0);
  });

  it("never constructs a Function once the app's zod config is imported", async () => {
    expect(await parseAndCountFunctionConstructions(true)).toBe(0);
  });
});
