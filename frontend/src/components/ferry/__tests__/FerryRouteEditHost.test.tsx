import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { ferryFixture } from "./ferryFixture";

const get = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api/ferry", () => ({ ferryApi: { get } }));
const editor = vi.hoisted(() => ({ onSaved: null as null | ((r: unknown) => void) }));
vi.mock("../FerryRouteEditor", () => ({
  FerryRouteEditor: (props: { ride: { id: string }; onSaved: (r: unknown) => void }) => {
    editor.onSaved = props.onSaved;
    return <div data-testid="editor-for">{props.ride.id}</div>;
  },
}));

import { FerryRouteEditHost } from "../FerryRouteEditHost";
import { useFerryRouteEditStore } from "../../../store/ferryRouteEditStore";

describe("FerryRouteEditHost (dashboard, GitHub #407)", () => {
  beforeEach(() => {
    get.mockReset();
    useFerryRouteEditStore.getState().close();
  });

  it("shows nothing until the ferry card asks for the editor", () => {
    render(<FerryRouteEditHost onSaved={vi.fn()} />);
    expect(screen.queryByTestId("ferry-route-edit-host")).toBeNull();
  });

  it("opens the crossing's editor over the map and redraws the dashboard once saved", async () => {
    const onSaved = vi.fn();
    get.mockResolvedValue(ferryFixture({ id: "newest" }));
    render(<FerryRouteEditHost onSaved={onSaved} />);
    act(() => useFerryRouteEditStore.getState().open("newest"));
    expect(await screen.findByTestId("editor-for")).toHaveTextContent("newest");
    act(() => editor.onSaved?.({}));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(useFerryRouteEditStore.getState().crossingId).toBeNull();
  });

  it("tells the user when the crossing cannot be loaded", async () => {
    get.mockRejectedValue(new Error("network"));
    render(<FerryRouteEditHost onSaved={vi.fn()} />);
    act(() => useFerryRouteEditStore.getState().open("x"));
    await waitFor(() => expect(screen.getByTestId("ferry-route-edit-failed")).toBeInTheDocument());
  });
});
