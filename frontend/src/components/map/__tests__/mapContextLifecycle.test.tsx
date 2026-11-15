// forgejo#332: the browser allows only 8-16 live WebGL contexts, so every map
// surface must give its context back when it unmounts. This drives the real
// react-map-gl `Map` + `useControl` (the wiring every map in the app uses)
// against a counting stand-in for MapLibre and asserts the live count returns
// to zero after repeated mount/unmount cycles, mode switches included.
// The stand-in is also what a source scan below holds the app to: no map may
// keep a context alive behind the pool's back.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { JSX } from "react";
import MapGL from "react-map-gl/maplibre";
import { DeckGLOverlay } from "../DeckGLOverlay";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { disableMapReuse, reuseMapsEnabled, resetMapReuseForTests } from "../../../lib/mapReuse";

const live = vi.hoisted(() => ({
  maps: 0,
  overlays: 0,
  removed: 0,
  finalized: 0,
  /** WebGL contexts the standalone deck overlays opened, minus the ones given back. */
  deckContexts: 0,
}));

// The real wrapper over a stand-in for deck's MapboxOverlay: a standalone one
// owns a canvas with a context of its own and — like deck.gl — never releases
// it by itself when it is finalized.
vi.mock("@deck.gl/mapbox", () => ({
  MapboxOverlay: class {
    private canvas: HTMLCanvasElement | null = null;
    constructor(private readonly props: { interleaved?: boolean }) {}
    onAdd(): HTMLElement {
      live.overlays += 1;
      if (!this.props.interleaved) {
        this.canvas = document.createElement("canvas");
        (this.canvas as unknown as { __gl: unknown }).__gl = {
          getExtension: () => ({ loseContext: () => (live.deckContexts -= 1) }),
        };
        live.deckContexts += 1;
      }
      return document.createElement("div");
    }
    onRemove(): void {
      live.overlays -= 1;
      live.finalized += 1;
      this.canvas = null;
    }
    getCanvas(): HTMLCanvasElement | null {
      return this.canvas;
    }
    setProps(): void {}
  },
}));

class FakeMap {
  private readonly container: HTMLElement;
  private readonly canvas = document.createElement("canvas");
  private handlers = new Map<string, ((e: unknown) => void)[]>();
  transform = { center: { lng: 0, lat: 0 }, zoom: 1, bearing: 0, pitch: 0, padding: {} };
  constructor(options: { container: HTMLElement }) {
    this.container = options.container;
    this.container.appendChild(this.canvas);
    live.maps += 1;
    queueMicrotask(() => this.fire("load"));
  }
  private fire(type: string): void {
    for (const h of this.handlers.get(type) ?? []) h({ type, target: this });
  }
  on(type: string, a: unknown, b?: unknown): this {
    const fn = (typeof a === "function" ? a : b) as (e: unknown) => void;
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
    return this;
  }
  off(): this {
    return this;
  }
  once(): this {
    return this;
  }
  getContainer(): HTMLElement {
    return this.container;
  }
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }
  private controls = new Set<unknown>();
  addControl(control: { onAdd: (m: unknown) => HTMLElement }): void {
    this.controls.add(control);
    control.onAdd(this);
  }
  removeControl(control: { onRemove: (m: unknown) => void }): void {
    this.controls.delete(control);
    control.onRemove(this);
  }
  hasControl(control: unknown): boolean {
    return this.controls.has(control);
  }
  remove(): void {
    live.maps -= 1;
    live.removed += 1;
  }
  isStyleLoaded(): boolean {
    return true;
  }
  loaded(): boolean {
    return true;
  }
  getStyle(): object {
    return {};
  }
  setStyle(): void {}
  getCenter(): { lng: number; lat: number } {
    return { lng: 0, lat: 0 };
  }
  getZoom(): number {
    return 1;
  }
  getBearing(): number {
    return 0;
  }
  getPitch(): number {
    return 0;
  }
  getPadding(): object {
    return {};
  }
  getProjection(): object {
    return { type: "mercator" };
  }
  setProjection(): void {}
  resize(): void {}
  triggerRepaint(): void {}
  _render(): void {}
  jumpTo(): void {}
  isMoving(): boolean {
    return false;
  }
  getBounds(): object {
    return { toArray: () => [] };
  }
  project(): { x: number; y: number } {
    return { x: 0, y: 0 };
  }
  unproject(): { lng: number; lat: number } {
    return { lng: 0, lat: 0 };
  }
  setRenderWorldCopies(): void {}
  setMaxBounds(): void {}
  setMinZoom(): void {}
  setMaxZoom(): void {}
  setMinPitch(): void {}
  setMaxPitch(): void {}
}

const mapLib = Promise.resolve({ Map: FakeMap }) as never;

function Surface({
  reuse,
  interleaved = false,
}: {
  reuse: boolean;
  interleaved?: boolean;
}): JSX.Element {
  return (
    <MapGL
      mapLib={mapLib}
      reuseMaps={reuse}
      initialViewState={{ longitude: 0, latitude: 0, zoom: 1 }}
    >
      <DeckGLOverlay layers={[]} interleaved={interleaved} />
    </MapGL>
  );
}

beforeEach(() => {
  live.maps = 0;
  live.overlays = 0;
  live.removed = 0;
  live.finalized = 0;
  live.deckContexts = 0;
  resetMapReuseForTests();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement
  ) {
    return ((this as unknown as { __gl?: unknown }).__gl ?? null) as never;
  });
});
afterEach(() => {
  resetMapReuseForTests();
  vi.restoreAllMocks();
});

describe("map surfaces release their WebGL context on unmount (forgejo#332)", () => {
  it("removes the map and finalizes its overlay on every unmount, so the live count never grows", async () => {
    for (let i = 0; i < 6; i++) {
      const { unmount } = render(<Surface reuse={false} />);
      await waitFor(() => expect(live.maps).toBe(1));
      await waitFor(() => expect(live.overlays).toBe(1));
      unmount();
      expect(live.maps).toBe(0);
      expect(live.overlays).toBe(0);
    }
    expect(live.removed).toBe(6);
    expect(live.finalized).toBe(6);
  });

  it("gives a standalone deck overlay's own WebGL context back when the map goes, which deck.gl itself does not", async () => {
    for (let i = 0; i < 5; i++) {
      const { unmount } = render(<Surface reuse={false} />);
      await waitFor(() => expect(live.deckContexts).toBe(1));
      unmount();
      await waitFor(() => expect(live.deckContexts).toBe(0));
    }
  });

  it("leaves an interleaved overlay alone: it shares the map's context, which map.remove() releases", async () => {
    const { unmount } = render(<Surface reuse={false} interleaved />);
    await waitFor(() => expect(live.overlays).toBe(1));
    expect(live.deckContexts).toBe(0);
    unmount();
    expect(live.deckContexts).toBe(0);
  });

  it("holds at one live map across a mode switch that swaps one surface for another", async () => {
    const { rerender, unmount } = render(<Surface key="globe" reuse={false} />);
    await waitFor(() => expect(live.maps).toBe(1));
    for (let i = 0; i < 4; i++) {
      rerender(<Surface key={i % 2 ? "globe" : "flat"} reuse={false} />);
      await waitFor(() => expect(live.maps).toBe(1));
      await waitFor(() => expect(live.overlays).toBe(1));
    }
    unmount();
    expect(live.maps).toBe(0);
  });

  it("keeps a pooled map's context only as long as reuse is on, and stops pooling after a loss", async () => {
    // With reuse on, an unmounted map stays alive in react-map-gl's pool and
    // the next one takes it: bounded at one, which is why reuse is allowed.
    const first = render(<Surface reuse={reuseMapsEnabled()} />);
    await waitFor(() => expect(live.maps).toBe(1));
    first.unmount();
    expect(live.maps).toBe(1);
    const second = render(<Surface reuse={reuseMapsEnabled()} />);
    expect(live.maps).toBe(1);
    second.unmount();
    // A loss turns reuse off: the next map is built fresh, the pooled one is not taken.
    disableMapReuse();
    expect(reuseMapsEnabled()).toBe(false);
    const third = render(<Surface reuse={reuseMapsEnabled()} />);
    await waitFor(() => expect(live.maps).toBe(2));
    third.unmount();
    expect(live.maps).toBe(1);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("no map bypasses the reuse switch", () => {
  it("never passes a bare `reuseMaps` — it goes through reuseMapsEnabled() so a lost context is not recycled", () => {
    const offenders = sourceFiles(join(__dirname, "../../..")).filter((file) =>
      /^\s*reuseMaps(\s*=\s*\{\s*true\s*\})?\s*$/m.test(readFileSync(file, "utf8"))
    );
    expect(offenders).toEqual([]);
  });
});
