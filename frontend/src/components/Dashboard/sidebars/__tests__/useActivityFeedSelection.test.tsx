import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { useActivityFeedSelection } from "../useActivityFeedSelection";
import type { ActivityFeedItem } from "../../../../lib/api/activityFeed";
import { useFlightSelectionStore } from "../../../../store/flightSelectionStore";
import { useMapFocusStore } from "../../../../store/mapFocusStore";
import { useToastStore } from "../../../../store/toastStore";
import { usePageErrorStore } from "../../../../store/pageErrorStore";

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

const flightRow: ActivityFeedItem = {
  key: "flight:f1",
  domain: "flight",
  id: "f1",
  subjectId: "f1",
  title: "MUC → VIE",
  subtitle: null,
  place: null,
  date: null,
  sortAt: null,
  planned: true,
  point: null,
  bbox: [11.78, 48.11, 16.57, 48.35],
  path: "/flights/f1",
};

describe("useActivityFeedSelection", () => {
  beforeEach(() => {
    useFlightSelectionStore.getState().clearSelection();
    useToastStore.setState({ toasts: [] });
    usePageErrorStore.getState().clear();
  });

  it("a row click writes the map's own selection and asks the camera for the route's bounds", async () => {
    const flight = { id: "f1" } as never;
    const { result } = renderHook(
      () =>
        useActivityFeedSelection({
          findFlight: () => flight,
          cruises: [],
          lodgings: [],
          places: [],
          domainFilter: { isVisible: () => true, toggle: vi.fn() },
        }),
      { wrapper }
    );
    const before = useMapFocusStore.getState().seq;
    act(() => result.current.onSelect(flightRow));
    await waitFor(() => expect(useMapFocusStore.getState().seq).toBe(before + 1));
    expect(useFlightSelectionStore.getState().selectedFlights).toEqual([flight]);
    expect(useMapFocusStore.getState().request).toMatchObject({ bbox: flightRow.bbox });
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("switches an unticked domain on and tells the reader", async () => {
    const toggle = vi.fn();
    const { result } = renderHook(
      () =>
        useActivityFeedSelection({
          findFlight: () => ({ id: "f1" }) as never,
          cruises: [],
          lodgings: [],
          places: [],
          domainFilter: { isVisible: () => false, toggle },
        }),
      { wrapper }
    );
    act(() => result.current.onSelect(flightRow));
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    expect(toggle).toHaveBeenCalledWith("flight");
    expect(useToastStore.getState().toasts[0].message).toMatch(/focusSwitchedOn/);
  });

  it("says so, with a visible error, when the entry cannot be opened", async () => {
    const { result } = renderHook(
      () =>
        useActivityFeedSelection({
          findFlight: () => undefined,
          cruises: [],
          lodgings: [],
          places: [],
          domainFilter: { isVisible: () => true, toggle: vi.fn() },
        }),
      { wrapper }
    );
    act(() => result.current.onSelect(flightRow));
    await waitFor(() => expect(usePageErrorStore.getState().errors).toHaveLength(1));
    expect(usePageErrorStore.getState().errors[0].message).toMatch(/focusNotLoaded/);
  });
});
