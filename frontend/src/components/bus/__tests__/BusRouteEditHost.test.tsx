import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { rideFixture } from "./busFixture";

const get = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api/bus", () => ({ busApi: { get } }));
const editor = vi.hoisted(() => ({ onSaved: null as null | ((r: unknown) => void) }));
vi.mock("../BusRouteEditor", () => ({
  BusRouteEditor: (props: { ride: { id: string }; onSaved: (r: unknown) => void }) => {
    editor.onSaved = props.onSaved;
    return <div data-testid="editor-for">{props.ride.id}</div>;
  },
}));

import { BusRouteEditHost } from "../BusRouteEditHost";
import { useBusRouteEditStore } from "../../../store/busRouteEditStore";

describe("BusRouteEditHost (dashboard, GitHub #409)", () => {
  beforeEach(() => {
    get.mockReset();
    useBusRouteEditStore.getState().close();
  });

  it("shows nothing until the bus card asks for the editor", () => {
    render(<BusRouteEditHost onSaved={vi.fn()} />);
    expect(screen.queryByTestId("bus-route-edit-host")).toBeNull();
  });

  it("opens the ride's editor over the map and redraws the dashboard once saved", async () => {
    const onSaved = vi.fn();
    get.mockResolvedValue({ ...rideFixture(), id: "newest" });
    render(<BusRouteEditHost onSaved={onSaved} />);
    act(() => useBusRouteEditStore.getState().open("newest"));
    expect(await screen.findByTestId("editor-for")).toHaveTextContent("newest");
    act(() => editor.onSaved?.({}));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(useBusRouteEditStore.getState().rideId).toBeNull();
  });

  it("tells the user when the ride cannot be loaded", async () => {
    get.mockRejectedValue(new Error("network"));
    render(<BusRouteEditHost onSaved={vi.fn()} />);
    act(() => useBusRouteEditStore.getState().open("x"));
    await waitFor(() => expect(screen.getByTestId("bus-route-edit-failed")).toBeInTheDocument());
  });
});
