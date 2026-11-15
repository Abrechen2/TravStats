// forgejo#386 REF-3: the globe and the trip map used to carry their own copies
// of this wrapper. What made them differ is now props; this pins what each
// caller's profile hands to deck.gl, so the three cannot drift apart silently.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { PickingInfo } from "@deck.gl/core";

const state = vi.hoisted(() => ({
  ctor: [] as Record<string, unknown>[],
  setProps: [] as Record<string, unknown>[],
  cursor: [] as boolean[],
  options: [] as unknown[],
}));

vi.mock("react-map-gl/maplibre", () => ({
  useMap: () => ({ current: { id: "map" } }),
  useControl: (factory: () => unknown, ...rest: unknown[]) => {
    state.options.push(rest[rest.length - 1]);
    return factory();
  },
}));
vi.mock("@deck.gl/mapbox", () => ({
  MapboxOverlay: class {
    constructor(props: Record<string, unknown>) {
      state.ctor.push(props);
    }
    setProps(props: Record<string, unknown>): void {
      state.setProps.push(props);
    }
    getCanvas(): null {
      return null;
    }
  },
}));
vi.mock("../mapCursor", () => ({
  applyHoverCursor: (_map: unknown, over: boolean) => state.cursor.push(over),
}));

import { DeckGLOverlay } from "../DeckGLOverlay";

const pick = (x: number, object?: unknown): PickingInfo =>
  ({ x, y: 1, object }) as unknown as PickingInfo;
const last = <T,>(list: T[]): T => list[list.length - 1];

beforeEach(() => {
  state.ctor.length = 0;
  state.setProps.length = 0;
  state.cursor.length = 0;
  state.options.length = 0;
});

describe("DeckGLOverlay profiles", () => {
  it("flat map: 5 px picking, not interleaved, no cursor handling without an onHover", () => {
    render(<DeckGLOverlay layers={[]} />);
    expect(state.ctor[0]).toMatchObject({ pickingRadius: 5 });
    expect(state.ctor[0]).not.toHaveProperty("interleaved");
    expect(state.ctor[0]).not.toHaveProperty("onHover");
    expect(state.options[0]).toEqual({ position: "top-left" });
  });

  it("globe: interleaved, its own getCursor, and hover passed through without touching the cursor", () => {
    const onHover = vi.fn();
    const getCursor = () => "grab";
    render(
      <DeckGLOverlay
        layers={[]}
        interleaved
        onHover={onHover}
        getCursor={getCursor}
        handleCursor={false}
      />
    );
    expect(state.ctor[0]).toMatchObject({
      interleaved: true,
      getCursor,
      onHover,
      pickingRadius: 5,
    });
    (last(state.setProps).onHover as (i: PickingInfo) => void)(pick(3, {}));
    expect(onHover).toHaveBeenCalledTimes(1);
    expect(state.cursor).toEqual([]);
  });

  it("trip map: 8 px picking and the hand over deck objects AND native features, with no onHover given", () => {
    render(
      <DeckGLOverlay
        layers={[]}
        interleaved={false}
        pickingRadius={8}
        handleCursor
        isOverNative={(x) => x === 7}
        onClick={vi.fn()}
      />
    );
    expect(state.ctor[0]).toMatchObject({ interleaved: false, pickingRadius: 8 });
    const hover = last(state.setProps).onHover as (i: PickingInfo) => void;
    hover(pick(1));
    hover(pick(1, { id: "arc" }));
    hover(pick(7));
    expect(state.cursor).toEqual([false, true, true]);
  });

  it("lets a native feature win the click over a deck object beneath it", () => {
    const onClick = vi.fn();
    render(<DeckGLOverlay layers={[]} onClick={onClick} isOverNative={(x) => x === 7} />);
    const click = last(state.setProps).onClick as (i: PickingInfo) => void;
    click(pick(7, { id: "arc" }));
    expect(onClick).not.toHaveBeenCalled();
    click(pick(1, { id: "arc" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
