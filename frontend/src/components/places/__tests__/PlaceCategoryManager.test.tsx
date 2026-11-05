import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const listMock = vi.hoisted(() => vi.fn());
const createMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api/placeCategories", () => ({
  listPlaceCategories: (...a: unknown[]) => listMock(...a),
  createPlaceCategory: (...a: unknown[]) => createMock(...a),
  deletePlaceCategory: (...a: unknown[]) => deleteMock(...a),
}));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

import PlaceCategoryManager from "../PlaceCategoryManager";
import { resetPlaceCategoriesCache } from "../../../hooks/usePlaceCategories";
import { placeCategoryIcon, placeCategoryLabel } from "../../../lib/placeCategoryDisplay";

const pool = { id: "c1", name: "Schwimmbad", icon: "🏊" };

describe("own place categories — display", () => {
  it("shows a custom name as written (a dot must not be read as a translation path) with its glyph", () => {
    const t = (key: string) => `T(${key})`;
    expect(placeCategoryLabel(t, "St. Pauli Kiez")).toBe("St. Pauli Kiez");
    expect(placeCategoryLabel(t, "museum")).toBe("T(places:categories.museum)");
    expect(placeCategoryIcon("Schwimmbad", [pool])).toBe("🏊");
    // A deleted or imported label has no definition: the default pin, not undefined.
    expect(placeCategoryIcon("food", [pool])).toBe("📍");
  });
});

describe("PlaceCategoryManager", () => {
  beforeEach(() => {
    resetPlaceCategoriesCache();
    listMock.mockReset().mockResolvedValue([pool]);
    createMock.mockReset();
    deleteMock.mockReset();
  });

  it("creates a category and hands its name to the form so it is selected at once", async () => {
    const onCreated = vi.fn();
    createMock.mockResolvedValue({ id: "c2", name: "Freizeitpark", icon: "🎢" });
    const user = userEvent.setup();
    render(<PlaceCategoryManager onCreated={onCreated} />);
    await user.type(screen.getByTestId("place-category-name"), "Freizeitpark");
    await user.click(screen.getByTestId("place-category-add"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("Freizeitpark"));
    expect(createMock).toHaveBeenCalledWith({ name: "Freizeitpark", icon: "📍" });
  });

  it("says a built-in name is taken instead of failing silently", async () => {
    createMock.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { code: "PLACE_CATEGORY_BUILT_IN" } },
    });
    const user = userEvent.setup();
    render(<PlaceCategoryManager />);
    await user.type(screen.getByTestId("place-category-name"), "Natur");
    await user.click(screen.getByTestId("place-category-add"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "places:customCategories.errors.builtIn"
    );
  });

  it("says a reserved filter name is refused, with its own message", async () => {
    createMock.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { code: "PLACE_CATEGORY_RESERVED" } },
    });
    const user = userEvent.setup();
    render(<PlaceCategoryManager />);
    await user.type(screen.getByTestId("place-category-name"), "all");
    await user.click(screen.getByTestId("place-category-add"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "places:customCategories.errors.reserved"
    );
  });

  it("asks before deleting and reports the fallback to the form", async () => {
    const onDeleted = vi.fn();
    deleteMock.mockResolvedValue({ movedPlaces: 3 });
    const user = userEvent.setup();
    render(<PlaceCategoryManager onDeleted={onDeleted} />);
    await user.click(await screen.findByTestId("place-category-delete-c1"));
    expect(deleteMock).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("place-category-delete-confirm-c1"));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("c1"));
    expect(onDeleted).toHaveBeenCalledWith("Schwimmbad");
  });
});

describe("usePlaceCategories — one account's categories", () => {
  it("does not show the previous account's categories after another user signs in", async () => {
    const { useAuthStore } = await import("../../../store/authStore");
    const { renderHook, act } = await import("@testing-library/react");
    const { usePlaceCategories } = await import("../../../hooks/usePlaceCategories");
    resetPlaceCategoriesCache();
    listMock.mockReset().mockResolvedValueOnce([pool]).mockResolvedValueOnce([]);
    act(() => useAuthStore.setState({ user: { id: "u1" } as never }));
    const { result } = renderHook(() => usePlaceCategories());
    await waitFor(() => expect(result.current.customs).toEqual([pool]));
    act(() => useAuthStore.setState({ user: { id: "u2" } as never }));
    await waitFor(() => expect(result.current.customs).toEqual([]));
    expect(listMock).toHaveBeenCalledTimes(2);
  });
});
