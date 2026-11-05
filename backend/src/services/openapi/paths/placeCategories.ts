/**
 * The user's own place categories — `routes/placeCategories.ts`. Built-in
 * categories are not rows; a place carries a custom category by its NAME.
 */

import { z } from "zod";

import { registry } from "../registry";
import { prismaColumns } from "../prismaColumns";
import { createPlaceCategorySchema } from "../../../schemas/place";
import { errorContent } from "./shared";

const tag = ["Places"];
const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });
const category = z.object({ ...prismaColumns("PlaceCategoryDef") });

registry.registerPath({
  method: "get",
  path: "/place-categories",
  summary: "The caller's own place categories",
  tags: tag,
  responses: {
    200: {
      description: "Categories, by name",
      content: { "application/json": { schema: envelope(z.array(category)) } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/place-categories",
  summary: "Add an own place category",
  description:
    "409 `PLACE_CATEGORY_BUILT_IN` when a built-in category already has the name, " +
    "`PLACE_CATEGORY_RESERVED` for a name the category filter owns (`all`), " +
    "`PLACE_CATEGORY_EXISTS` for a repeat. 400 `PLACE_CATEGORY_LIMIT` past 50.",
  tags: tag,
  request: { body: { content: { "application/json": { schema: createPlaceCategorySchema } } } },
  responses: {
    201: {
      description: "Created",
      content: { "application/json": { schema: envelope(category) } },
    },
    400: { description: "Invalid input", content: errorContent },
    409: { description: "Name taken", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/place-categories/{id}",
  summary: "Delete an own place category",
  description:
    "The places that carried it fold to `other` in the same transaction; none is deleted.",
  tags: tag,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: "Deleted",
      content: {
        "application/json": {
          schema: envelope(z.object({ movedPlaces: z.number().int() })),
        },
      },
    },
    404: { description: "Not found", content: errorContent },
  },
});
