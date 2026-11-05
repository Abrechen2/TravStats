import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RatingCategoriesManager } from "../RatingCategoriesManager";
import {
  addOwnRatingCategory,
  setActiveRatingCategories,
  deleteOwnRatingCategory,
  getRatingCategories,
} from "../../../lib/api/lodging";
import { useRatingCategoriesStore } from "../../../store/lodgingRatingCategoriesStore";

vi.mock("../../../lib/api/lodging", () => ({
  getRatingCategories: vi.fn(),
  setActiveRatingCategories: vi.fn(),
  addOwnRatingCategory: vi.fn(),
  renameOwnRatingCategory: vi.fn(),
  deleteOwnRatingCategory: vi.fn(),
}));

const BUILT_IN = ["room", "bed", "breakfast", "service", "parking"];
const view = (active: string[], custom: { id: string; name: string; deleted: boolean }[] = []) => ({
  builtIn: BUILT_IN,
  active,
  custom: custom.map((c) => ({ ...c, key: `custom:${c.id}` })),
});

describe("RatingCategoriesManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRatingCategories).mockResolvedValue(view(["room", "breakfast", "service"]));
    useRatingCategoriesStore.setState({ loaded: false });
  });

  it("switches a built-in category on and sends the whole new set", async () => {
    vi.mocked(setActiveRatingCategories).mockResolvedValue(
      view(["room", "breakfast", "service", "parking"])
    );
    render(<RatingCategoriesManager open onOpenChange={vi.fn()} />);
    await userEvent.click(await screen.findByTestId("rating-category-toggle-parking"));
    expect(setActiveRatingCategories).toHaveBeenCalledWith([
      "room",
      "breakfast",
      "service",
      "parking",
    ]);
    await waitFor(() => expect(screen.getByTestId("rating-category-toggle-parking")).toBeChecked());
  });

  it("adds an own category and says so when the server refuses a duplicate", async () => {
    vi.mocked(addOwnRatingCategory).mockRejectedValue({
      isAxiosError: true,
      response: { status: 409 },
    });
    render(<RatingCategoriesManager open onOpenChange={vi.fn()} />);
    await userEvent.type(await screen.findByTestId("rating-category-new-name"), "Aussicht");
    await userEvent.click(screen.getByTestId("rating-category-add"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "lodging:stayEditor.ratingCategoryDuplicate"
    );
  });

  it("deletes an own category through the server and drops it from the list", async () => {
    vi.mocked(getRatingCategories).mockResolvedValue(
      view(["room"], [{ id: "c1", name: "Aussicht", deleted: false }])
    );
    vi.mocked(deleteOwnRatingCategory).mockResolvedValue(
      view(["room"], [{ id: "c1", name: "Aussicht", deleted: true }])
    );
    render(<RatingCategoriesManager open onOpenChange={vi.fn()} />);
    await userEvent.click(await screen.findByTestId("rating-category-delete-c1"));
    expect(deleteOwnRatingCategory).toHaveBeenCalledWith("c1");
    await waitFor(() => expect(screen.queryByTestId("rating-category-delete-c1")).toBeNull());
  });
});
