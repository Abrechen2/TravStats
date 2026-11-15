import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, type JSX } from "react";
vi.unmock("../../lib/webgl2");

import WebGLGuard, {
  WEBGL_LOSS_WINDOW_MS,
  WEBGL_MAX_LOSSES,
  WEBGL_REMOUNT_DELAY_MS,
} from "./WebGLGuard";

function Boom({ error }: { error: Error }): never {
  throw error;
}

function stubGetContext(gl: unknown): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => gl) as unknown as HTMLCanvasElement["getContext"]
  );
}

afterEach(() => vi.restoreAllMocks());

describe("WebGLGuard (forgejo#332)", () => {
  it("shows the message and keeps the rest of the page when WebGL2 context creation returns null", () => {
    stubGetContext(null);
    render(
      <div>
        <p>flight list</p>
        <WebGLGuard>
          <p>the map</p>
        </WebGLGuard>
        <p>stats table</p>
      </div>
    );
    expect(screen.getByRole("alert").textContent).toBe("map:webglUnavailable");
    expect(screen.queryByText("the map")).toBeNull();
    expect(screen.getByText("flight list")).toBeTruthy();
    expect(screen.getByText("stats table")).toBeTruthy();
  });

  it("renders the map and releases the probe context when WebGL2 is available", () => {
    const loseContext = vi.fn();
    stubGetContext({ getExtension: () => ({ loseContext }) });
    render(
      <WebGLGuard>
        <p>the map</p>
      </WebGLGuard>
    );
    expect(screen.getByText("the map")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it("turns a GPUInitializationError thrown by the map into the message instead of a crash", () => {
    stubGetContext({ getExtension: () => null });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("WebGL2 is required to display this map.");
    err.name = "GPUInitializationError";
    render(
      <div>
        <p>rest of page</p>
        <WebGLGuard>
          <Boom error={err} />
        </WebGLGuard>
      </div>
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("rest of page")).toBeTruthy();
  });

  it("does not swallow an unrelated render error", () => {
    stubGetContext({ getExtension: () => null });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <WebGLGuard>
          <Boom error={new Error("unrelated")} />
        </WebGLGuard>
      )
    ).toThrow("unrelated");
  });

  describe("a context lost while the map runs (forgejo#332)", () => {
    // A stand-in for a map: owns a canvas, counts how often it is built and
    // torn down, the way react-map-gl's Map does with maplibre's map.remove().
    function renderMap(): { mounts: () => number; unmounts: () => number } {
      let mounts = 0;
      let unmounts = 0;
      function FakeMap(): JSX.Element {
        useEffect(() => {
          mounts += 1;
          return () => {
            unmounts += 1;
          };
        }, []);
        return <canvas data-testid="map-canvas" />;
      }
      stubGetContext({ getExtension: () => ({ loseContext: () => {} }) });
      render(
        <WebGLGuard>
          <FakeMap />
        </WebGLGuard>
      );
      return { mounts: () => mounts, unmounts: () => unmounts };
    }
    const lose = (): void => {
      fireEvent(screen.getByTestId("map-canvas"), new Event("webglcontextlost"));
    };

    it("says so instead of leaving a dead canvas, then rebuilds the map", () => {
      vi.useFakeTimers();
      try {
        const map = renderMap();
        expect(map.mounts()).toBe(1);
        act(() => lose());
        expect(screen.getByTestId("webgl-lost").textContent).toContain("map:webglLost");
        expect(screen.queryByTestId("map-canvas")).toBeNull();
        expect(map.unmounts()).toBe(1);
        act(() => {
          vi.advanceTimersByTime(WEBGL_REMOUNT_DELAY_MS + 1);
        });
        expect(screen.queryByTestId("webgl-lost")).toBeNull();
        expect(screen.getByTestId("map-canvas")).toBeTruthy();
        expect(map.mounts()).toBe(2);
        // the dead map was released, the new one is the only one alive
        expect(map.mounts() - map.unmounts()).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("stops rebuilding after repeated losses and offers a button instead", () => {
      vi.useFakeTimers();
      try {
        const map = renderMap();
        for (let i = 0; i < WEBGL_MAX_LOSSES - 1; i++) {
          act(() => lose());
          act(() => {
            vi.advanceTimersByTime(WEBGL_REMOUNT_DELAY_MS + 1);
          });
        }
        act(() => lose());
        expect(screen.getByTestId("webgl-lost").textContent).toContain("map:webglLostGaveUp");
        act(() => {
          vi.advanceTimersByTime(WEBGL_LOSS_WINDOW_MS);
        });
        expect(screen.queryByTestId("map-canvas")).toBeNull();
        expect(map.mounts()).toBe(WEBGL_MAX_LOSSES);
        fireEvent.click(screen.getByRole("button"));
        expect(screen.getByTestId("map-canvas")).toBeTruthy();
        expect(map.mounts()).toBe(WEBGL_MAX_LOSSES + 1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("ignores a context lost by something outside the guard", () => {
      renderMap();
      const stray = document.createElement("canvas");
      document.body.appendChild(stray);
      fireEvent(stray, new Event("webglcontextlost"));
      expect(screen.queryByTestId("webgl-lost")).toBeNull();
      expect(screen.getByTestId("map-canvas")).toBeTruthy();
    });
  });
});
