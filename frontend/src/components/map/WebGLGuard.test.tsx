import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
vi.unmock("../../lib/webgl2");

import WebGLGuard from "./WebGLGuard";

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
});
