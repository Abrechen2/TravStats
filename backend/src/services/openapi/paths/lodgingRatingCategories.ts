import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

/** Lodging rating categories: the switchable vocabulary and the user's own (spec 2026-08-25). */
const ratingCategoriesView = registry.register(
  "LodgingRatingCategories",
  z
    .object({
      builtIn: z.array(z.string()).describe("The whole built-in vocabulary, in display order"),
      active: z.array(z.string()).describe("The built-in categories switched on for this account"),
      custom: z.array(
        z.object({
          id: z.string().uuid(),
          key: z.string().describe("Key inside a stay's `ratings` map: `custom:<id>`"),
          name: z.string(),
          deleted: z
            .boolean()
            .describe(
              "A deleted category is no longer offered; values already given stay readable"
            ),
        })
      ),
    })
    .describe("Rating categories of the account: the vocabulary, the switched-on set, own ones.")
);

const ratingCategoriesResponse = {
  description: "The account's rating categories after the change",
  content: {
    "application/json": {
      schema: z.object({ success: z.boolean(), data: ratingCategoriesView }),
    },
  },
};

registry.registerPath({
  method: "get",
  path: "/lodging/rating-categories",
  summary: "Rating categories: the vocabulary, the switched-on set and own categories",
  tags: ["Lodging"],
  responses: { 200: ratingCategoriesResponse },
});

registry.registerPath({
  method: "put",
  path: "/lodging/rating-categories/active",
  summary: "Switch built-in rating categories on or off",
  description:
    "Replaces the switched-on set. Never rewrites a stay: an overall is the mean of the " +
    "values a stay has, whatever is switched on.",
  tags: ["Lodging"],
  request: {
    body: {
      content: {
        "application/json": { schema: z.object({ categories: z.array(z.string()) }) },
      },
    },
  },
  responses: {
    200: ratingCategoriesResponse,
    400: { description: "Unknown or duplicate category", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/lodging/rating-categories/custom",
  summary: "Add an own rating category",
  tags: ["Lodging"],
  request: {
    body: {
      content: { "application/json": { schema: z.object({ name: z.string().max(40) }) } },
    },
  },
  responses: {
    201: ratingCategoriesResponse,
    400: { description: "Invalid name or too many categories", content: errorContent },
    409: { description: "A category with this name exists", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/lodging/rating-categories/custom/{id}",
  summary: "Rename an own rating category",
  tags: ["Lodging"],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: { "application/json": { schema: z.object({ name: z.string().max(40) }) } },
    },
  },
  responses: {
    200: ratingCategoriesResponse,
    400: { description: "Invalid name", content: errorContent },
    404: { description: "Category not found", content: errorContent },
    409: { description: "A category with this name exists", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/lodging/rating-categories/custom/{id}",
  summary: "Delete an own rating category (soft)",
  description:
    "Values already given on stays stay readable under the category's name and keep " +
    "counting in those stays' overall; the category is only no longer offered.",
  tags: ["Lodging"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: ratingCategoriesResponse,
    404: { description: "Category not found", content: errorContent },
  },
});
