// forgejo#332: contexts the page opens for itself must go back to the browser,
// which allows only 8-16 live ones. Measured in a production build: the
// import-time probe held one for the life of the page, and every finalized
// standalone deck overlay left one behind.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.unmock("../webgl2");

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("webgl2 context release", () => {
  it("releases the import-time probe's context instead of holding it for the life of the page", async () => {
    const loseContext = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({
      getExtension: () => ({ loseContext }),
    })) as unknown as HTMLCanvasElement["getContext"]);
    vi.resetModules();
    const { webgl2Available } = await import("../webgl2");
    expect(webgl2Available).toBe(true);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  // 2.8.0-rc.35 moved the release into the probe's try: a browser that throws
  // while releasing would then read as "no WebGL2" — the tester's map lost every
  // deck.gl layer (2026-11-18). A context that was created means yes.
  it("still answers yes when releasing the probe's context throws", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({
      getExtension: () => {
        throw new Error("extension blocked");
      },
    })) as unknown as HTMLCanvasElement["getContext"]);
    vi.resetModules();
    const { webgl2Available, probeWebGL2 } = await import("../webgl2");
    expect(webgl2Available).toBe(true);
    expect(probeWebGL2()).toBe(true);
  });

  it("releaseWebGL2Context loses the canvas's context, and shrugs at a canvas that has none", async () => {
    const loseContext = vi.fn();
    const { releaseWebGL2Context } = await import("../webgl2");
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getContext").mockImplementation((() => ({
      getExtension: () => ({ loseContext }),
    })) as unknown as HTMLCanvasElement["getContext"]);
    releaseWebGL2Context(canvas);
    expect(loseContext).toHaveBeenCalledTimes(1);
    expect(() => releaseWebGL2Context(null)).not.toThrow();
    expect(() => releaseWebGL2Context(document.createElement("canvas"))).not.toThrow();
  });
});
