import { create } from "zustand";

import {
  addOwnRatingCategory,
  deleteOwnRatingCategory,
  getRatingCategories,
  renameOwnRatingCategory,
  setActiveRatingCategories,
  type RatingCategoriesView,
} from "../lib/api/lodging";
import { logger } from "../lib/logger";
import { DEFAULT_RATING_CATEGORIES, RATING_CATEGORIES } from "../shared/ratingCategories";

/**
 * The account's lodging rating categories: which built-in ones the stay form
 * offers and the user's own. Server-held, re-learned per session, so not
 * persisted. Until the first answer arrives the view is today's three built-in
 * categories - the same default the server gives - so a form opened before the
 * request returns still renders the pickers it always had.
 *
 * Every mutation replaces the view with the server's answer; a failure keeps
 * the previous view and rethrows so the caller can say why.
 */
interface RatingCategoriesState {
  view: RatingCategoriesView;
  loaded: boolean;
  load: () => Promise<void>;
  setActive: (categories: string[]) => Promise<void>;
  add: (name: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const INITIAL_VIEW: RatingCategoriesView = {
  builtIn: [...RATING_CATEGORIES],
  active: [...DEFAULT_RATING_CATEGORIES],
  custom: [],
};

export const useRatingCategoriesStore = create<RatingCategoriesState>((set) => {
  const apply = (view: RatingCategoriesView): void => set({ view, loaded: true });
  return {
    view: INITIAL_VIEW,
    loaded: false,
    load: async () => {
      try {
        apply(await getRatingCategories());
      } catch (err: unknown) {
        // The form keeps working on the defaults; the next open retries.
        logger.error("ratingCategories: could not load the account's categories", err);
      }
    },
    setActive: async (categories) => apply(await setActiveRatingCategories(categories)),
    add: async (name) => apply(await addOwnRatingCategory(name)),
    rename: async (id, name) => apply(await renameOwnRatingCategory(id, name)),
    remove: async (id) => {
      apply(await deleteOwnRatingCategory(id));
    },
  };
});
