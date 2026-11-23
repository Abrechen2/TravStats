import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";

vi.mock("../useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
const getCuratedProgress = vi.fn();
const listNewOutlets = vi.fn();
vi.mock("../../lib/api/placeLists", () => ({
  getCuratedProgress: (...a: unknown[]) => getCuratedProgress(...a),
}));
vi.mock("../../lib/api/smartLists", () => ({
  listNewOutlets: (...a: unknown[]) => listNewOutlets(...a),
}));

import { useListedPlaces } from "../useListedPlaces";
import { usePlaceListFilterStore } from "../../store/placeListFilterStore";
import type { Place } from "../../types/place";
import type { PlaceList } from "../../types/placeList";

const place = (id: string, visited = true): Place =>
  ({ id, name: id, lat: 1, lon: 1, visited, visitCount: visited ? 1 : 0 }) as Place;
const places = [place("a"), place("b")];
const lists = [
  { id: "macs", name: "McDonald", entries: [{ placeId: "a", place: place("a") }] },
] as unknown as PlaceList[];

const at = (url: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>;
  };

beforeEach(() => {
  window.localStorage.clear();
  usePlaceListFilterStore.setState({ selection: [], viewActive: false });
  getCuratedProgress.mockReset();
  listNewOutlets.mockReset().mockResolvedValue([]);
});

describe("useListedPlaces", () => {
  it("draws every place while no list is chosen", () => {
    const { result } = renderHook(() => useListedPlaces(places, lists, true), {
      wrapper: at("/dashboard"),
    });
    expect(result.current.drawn).toHaveLength(2);
    expect(result.current.active).toBe(false);
  });

  it("narrows to the chosen list and flags the view as a list view", async () => {
    usePlaceListFilterStore.setState({ selection: ["list:macs"] });
    const { result } = renderHook(() => useListedPlaces(places, lists, true), {
      wrapper: at("/dashboard"),
    });
    await waitFor(() => expect(result.current.drawn.map((p) => p.id)).toEqual(["a"]));
    expect(result.current.active).toBe(true);
    await waitFor(() => expect(usePlaceListFilterStore.getState().viewActive).toBe(true));
  });

  it("does not blank the map for a stored list that no longer exists", () => {
    usePlaceListFilterStore.setState({ selection: ["list:gone"] });
    const { result } = renderHook(() => useListedPlaces(places, lists, true), {
      wrapper: at("/dashboard"),
    });
    expect(result.current.drawn).toHaveLength(2);
    expect(result.current.active).toBe(false);
  });

  it("adds the not-yet-visited targets of a chosen checklist as ghosts", async () => {
    getCuratedProgress.mockResolvedValue({
      key: "wonders",
      items: [
        {
          itemId: "wonders:petra",
          name: "Petra",
          nameEn: null,
          lat: 1,
          lon: 2,
          country: null,
          isoCountryCode: null,
          continent: null,
          ticked: false,
          placeId: null,
        },
      ],
    });
    usePlaceListFilterStore.setState({ selection: ["curated:wonders"] });
    const { result } = renderHook(() => useListedPlaces(places, lists, true), {
      wrapper: at("/dashboard"),
    });
    await waitFor(() => expect(result.current.drawn).toHaveLength(1));
    expect(result.current.drawn[0]).toMatchObject({ id: "ghost:wonders:petra", visited: false });
  });

  it("reports a checklist that cannot be loaded instead of silently drawing less", async () => {
    getCuratedProgress.mockRejectedValue(new Error("down"));
    usePlaceListFilterStore.setState({ selection: ["curated:wonders"] });
    const { result } = renderHook(() => useListedPlaces(places, lists, true), {
      wrapper: at("/dashboard"),
    });
    await waitFor(() => expect(result.current.failed).toBe(true));
    await act(async () => {});
  });

  it("lets ?lists= win over the stored choice", async () => {
    usePlaceListFilterStore.setState({ selection: ["list:gone"] });
    const { result } = renderHook(() => useListedPlaces(places, lists, true), {
      wrapper: at("/dashboard?lists=macs"),
    });
    await waitFor(() =>
      expect(usePlaceListFilterStore.getState().selection).toEqual(["list:macs"])
    );
    await waitFor(() => expect(result.current.drawn.map((p) => p.id)).toEqual(["a"]));
  });

  it("writes the choice back to ?lists= when it changes, and drops it for 'Alle Orte'", async () => {
    const { result } = renderHook(
      () => ({ listed: useListedPlaces(places, lists, true), loc: useLocation() }),
      { wrapper: at("/dashboard?mode=markers") }
    );
    act(() => usePlaceListFilterStore.getState().toggle("list:macs"));
    await waitFor(() => expect(result.current.loc.search).toBe("?mode=markers&lists=macs"));
    act(() => usePlaceListFilterStore.getState().clear());
    await waitFor(() => expect(result.current.loc.search).toBe("?mode=markers"));
  });
});
